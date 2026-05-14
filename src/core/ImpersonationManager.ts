import { EventEmitter } from "./EventEmitter";
import { StorageManager } from "./StorageManager";
import { TimerManager } from "./TimerManager";
import type {
  ImpersonationAdapter,
  ImpersonationConfig,
  ImpersonationState,
  ImpersonationStatus,
  ImpersonationEventMap,
  ImpersonationEventName,
  StopReason,
  DEFAULTS as DefaultsType,
} from "./types";
import { DEFAULTS } from "./types";

export class ImpersonationManager {
  private adapter: ImpersonationAdapter;
  private events = new EventEmitter();
  private storage: StorageManager;
  private timer: TimerManager;

  private status: ImpersonationStatus = "idle";
  private targetDisplayName: string | null = null;
  private metadata: Record<string, unknown> | null = null;

  constructor(config: ImpersonationConfig) {
    this.adapter = config.adapter;

    const prefix = config.storagePrefix ?? DEFAULTS.storagePrefix;
    this.storage = new StorageManager(prefix, config.storage);

    this.timer = new TimerManager(
      {
        durationMs:
          config.durationMinutes != null
            ? config.durationMinutes * 60_000
            : (config.durationMs ?? DEFAULTS.durationMs),
        maxDurationMs:
          config.maxDurationMinutes != null
            ? config.maxDurationMinutes * 60_000
            : (config.maxDurationMs ?? DEFAULTS.maxDurationMs),
        tickIntervalMs: config.tickIntervalMs ?? DEFAULTS.tickIntervalMs,
        urgentThresholdSeconds:
          config.urgentThresholdSeconds ?? DEFAULTS.urgentThresholdSeconds,
      },
      this.events,
      this.storage
    );

    // Forward timer events as state changes
    this.events.on("tick", () => this.emitStateChange());
    this.events.on("extended", () => this.emitStateChange());
    this.events.on("expired", () => {
      this.handleExpired();
    });

    // Rehydrate if there was an active session (page refresh)
    this.rehydrate();
  }

  // ── Public API ───────────────────────────────────────────────────

  async start(targetUserId: string): Promise<void> {
    if (this.status !== "idle") {
      throw new Error(
        `Cannot start impersonation: current status is "${this.status}". ` +
          (this.status === "active"
            ? "End the current session first."
            : "A transition is already in progress.")
      );
    }

    this.setStatus("starting");

    try {
      // 1. Save admin session
      const snapshot = await this.adapter.saveCurrentSession();
      this.storage.saveSnapshot(snapshot);

      // 2. Create impersonated session
      const result = await this.adapter.createImpersonatedSession(targetUserId);

      // 3. Start timer
      this.timer.start();

      // 4. Update state
      this.targetDisplayName = result.targetDisplayName;
      this.metadata = result.metadata ?? null;
      this.storage.saveDisplayName(result.targetDisplayName);
      this.setStatus("active");

      this.events.emit("started", {
        targetDisplayName: result.targetDisplayName,
        metadata: result.metadata,
      });
    } catch (err) {
      // Rollback: clear any saved snapshot
      this.storage.clear();
      this.timer.stop();
      this.targetDisplayName = null;
      this.metadata = null;
      this.setStatus("idle");

      const error = err instanceof Error ? err : new Error(String(err));
      this.events.emit("error", { error, phase: "start" });
      throw error;
    }
  }

  async stop(reason: StopReason = "manual"): Promise<void> {
    if (this.status !== "active" && reason !== "orphan") {
      // Allow stopping from non-active state for orphan cleanup
      if (this.status === "idle") return;
      throw new Error(
        `Cannot stop impersonation: current status is "${this.status}".`
      );
    }

    this.setStatus("stopping");

    try {
      // 1. Stop timer
      this.timer.stop();

      // 2. Restore admin session
      const snapshot = this.storage.getSnapshot();
      if (snapshot) {
        if (this.adapter.destroyImpersonatedSession) {
          await this.adapter.destroyImpersonatedSession();
        }
        await this.adapter.restoreSession(snapshot);
      }

      // 3. Clear storage
      this.storage.clear();

      // 4. Reset state
      this.targetDisplayName = null;
      this.metadata = null;
      this.setStatus("idle");

      this.events.emit("stopped", { reason });
    } catch (err) {
      // Restore failed. The client is still holding the impersonated user's
      // session. As a last-resort, force the adapter to clear it so the app
      // is left in an unauthenticated state rather than silently
      // impersonated. clearSession is best-effort: if it also throws we
      // continue.
      if (this.adapter.clearSession) {
        try {
          await this.adapter.clearSession();
        } catch {
          // swallow — already in an error path
        }
      }

      this.storage.clear();
      this.timer.stop();
      this.targetDisplayName = null;
      this.metadata = null;
      this.setStatus("idle");

      const error = err instanceof Error ? err : new Error(String(err));
      this.events.emit("error", { error, phase: "stop" });
      // Always emit "stopped" so consumers' onStop handlers (which typically
      // redirect the user away) fire even when restore fails. The reason
      // distinguishes this from a clean stop so consumers can branch (e.g.
      // show a toast, force re-login).
      this.events.emit("stopped", { reason: "restore-failed" });
      throw error;
    }
  }

  extend(): void {
    if (this.status !== "active") return;

    const success = this.timer.extend();
    if (!success) {
      this.events.emit("error", {
        error: new Error("Cannot extend: max duration reached"),
        phase: "extend",
      });
    }
  }

  getState(): ImpersonationState {
    return {
      status: this.status,
      targetDisplayName: this.targetDisplayName,
      metadata: this.metadata,
      remainingMs: this.timer.remainingMs,
      remainingSeconds: this.timer.remainingSeconds,
      canExtend: this.timer.canExtend,
      isUrgent: this.timer.isUrgent,
      startedAt: this.timer.currentStartedAt,
      expiresAt: this.timer.currentExpiresAt,
    };
  }

  /** Check for orphaned impersonation sessions (call on app mount). */
  checkForOrphan(): boolean {
    if (this.storage.isOrphaned()) {
      this.storage.clearOrphanFlag();
      return true;
    }
    return false;
  }

  /** Subscribe to events. Returns an unsubscribe function. */
  on<E extends ImpersonationEventName>(
    event: E,
    handler: (data: ImpersonationEventMap[E]) => void
  ): () => void {
    return this.events.on(event, handler);
  }

  /** Clean up all intervals and listeners. */
  destroy(): void {
    this.timer.destroy();
    this.events.removeAllListeners();
  }

  // ── Internal ─────────────────────────────────────────────────────

  private setStatus(status: ImpersonationStatus): void {
    this.status = status;
    this.emitStateChange();
  }

  private emitStateChange(): void {
    this.events.emit("statechange", { state: this.getState() });
  }

  private async handleExpired(): Promise<void> {
    try {
      await this.stop("timeout");
    } catch {
      // Error already emitted by stop()
    }
  }

  /** Rehydrate state from storage after page refresh. */
  private rehydrate(): void {
    if (!this.storage.hasActiveSession()) return;

    const timerRestored = this.timer.rehydrate();
    if (timerRestored) {
      // We were impersonating and the timer hasn't expired
      this.status = "active";
      this.targetDisplayName = this.storage.getDisplayName();
      this.emitStateChange();
    } else {
      // Timer expired while page was closed — clean up
      this.storage.clear();
    }
  }
}
