import { EventEmitter } from "./EventEmitter";
import type { StorageManager } from "./StorageManager";

export interface TimerConfig {
  durationMs: number;
  maxDurationMs: number;
  tickIntervalMs: number;
  urgentThresholdSeconds: number;
}

export class TimerManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startedAt: number | null = null;
  private expiresAt: number | null = null;
  private expiringFired = false;

  constructor(
    private config: TimerConfig,
    private events: EventEmitter,
    private storage: StorageManager
  ) {}

  get isRunning(): boolean {
    return this.intervalId !== null;
  }

  get remainingMs(): number | null {
    if (this.expiresAt === null) return null;
    return Math.max(0, this.expiresAt - Date.now());
  }

  get remainingSeconds(): number | null {
    const ms = this.remainingMs;
    if (ms === null) return null;
    return Math.ceil(ms / 1000);
  }

  get canExtend(): boolean {
    if (this.startedAt === null) return false;
    const elapsed = Date.now() - this.startedAt;
    return elapsed + this.config.durationMs <= this.config.maxDurationMs;
  }

  get isUrgent(): boolean {
    const secs = this.remainingSeconds;
    if (secs === null) return false;
    return secs <= this.config.urgentThresholdSeconds;
  }

  get currentStartedAt(): number | null {
    return this.startedAt;
  }

  get currentExpiresAt(): number | null {
    return this.expiresAt;
  }

  start(): void {
    this.stop();

    const now = Date.now();
    this.startedAt = now;
    this.expiresAt = now + this.config.durationMs;
    this.expiringFired = false;

    this.storage.saveTimerState(this.startedAt, this.expiresAt);
    this.startTicking();
  }

  /** Rehydrate timer state from storage (after page refresh). */
  rehydrate(): boolean {
    const saved = this.storage.getTimerState();
    if (!saved) return false;

    // Already expired
    if (Date.now() >= saved.expiresAt) {
      return false;
    }

    this.startedAt = saved.startedAt;
    this.expiresAt = saved.expiresAt;
    this.expiringFired = false;
    this.startTicking();
    return true;
  }

  extend(): boolean {
    if (!this.canExtend) return false;

    const newExpiry = Date.now() + this.config.durationMs;
    this.expiresAt = newExpiry;
    this.expiringFired = false;

    this.storage.updateExpiry(newExpiry);
    this.events.emit("extended", { newExpiresAt: newExpiry });
    return true;
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.startedAt = null;
    this.expiresAt = null;
    this.expiringFired = false;
  }

  destroy(): void {
    this.stop();
  }

  private startTicking(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
    }
    this.intervalId = setInterval(() => this.tick(), this.config.tickIntervalMs);
    // Immediate first tick
    this.tick();
  }

  private tick(): void {
    const remaining = this.remainingMs;
    const remainingSecs = this.remainingSeconds;

    if (remaining === null || remainingSecs === null) return;

    if (remaining <= 0) {
      this.events.emit("expired", {});
      this.stop();
      return;
    }

    this.events.emit("tick", {
      remainingMs: remaining,
      remainingSeconds: remainingSecs,
    });

    // Fire "expiring" once when crossing the urgent threshold
    if (
      !this.expiringFired &&
      remainingSecs <= this.config.urgentThresholdSeconds
    ) {
      this.expiringFired = true;
      this.events.emit("expiring", { remainingSeconds: remainingSecs });
    }
  }
}
