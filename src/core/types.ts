// ============================================================================
// Layer 1: Adapter Protocol
// ============================================================================

/**
 * Opaque session snapshot. The adapter decides what goes inside.
 * Supabase stores {access_token, refresh_token}.
 * Django stores a session cookie. Firebase stores a custom token.
 * The core never inspects this.
 */
export interface SessionSnapshot {
  data: unknown;
}

/** Result returned after establishing an impersonated session. */
export interface ImpersonationResult {
  /** Display name of the target user (shown in the banner) */
  targetDisplayName: string;
  /** Optional metadata passed through events (role, email, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * The adapter protocol. Implement this for each auth backend.
 *
 * The core handles everything else: timers, storage, events, state machine.
 * The adapter only handles the auth-specific session operations.
 */
export interface ImpersonationAdapter {
  /** Capture the current admin session for later restoration. */
  saveCurrentSession(): Promise<SessionSnapshot>;

  /**
   * Create an impersonated session for the target user.
   * This should handle both the server call (get token) and the
   * client-side sign-in (establish session).
   */
  createImpersonatedSession(
    targetUserId: string
  ): Promise<ImpersonationResult>;

  /** Restore a previously saved admin session. */
  restoreSession(snapshot: SessionSnapshot): Promise<void>;

  /** Optional: destroy the impersonated session before restoring admin. */
  destroyImpersonatedSession?(): Promise<void>;
}

// ============================================================================
// Layer 2: Core Configuration
// ============================================================================

export interface ImpersonationConfig {
  /** The auth adapter to use (Supabase, Firebase, GenericHTTP, etc.) */
  adapter: ImpersonationAdapter;

  /** Duration of each impersonation window in ms. Default: 15 minutes. */
  durationMs?: number;

  /** Hard cap on total impersonation time in ms. Default: 60 minutes. */
  maxDurationMs?: number;

  /** Storage key prefix to avoid collisions. Default: "impersonate". */
  storagePrefix?: string;

  /** Timer tick interval in ms. Default: 1000 (1 second). */
  tickIntervalMs?: number;

  /** Seconds remaining before "expiring" event fires. Default: 60. */
  urgentThresholdSeconds?: number;

  /** Custom storage backend (for SSR/testing). Default: browser storage. */
  storage?: StorageBackend;
}

// ============================================================================
// State
// ============================================================================

export type ImpersonationStatus = "idle" | "starting" | "active" | "stopping";

export interface ImpersonationState {
  status: ImpersonationStatus;
  targetDisplayName: string | null;
  metadata: Record<string, unknown> | null;
  remainingMs: number | null;
  remainingSeconds: number | null;
  canExtend: boolean;
  isUrgent: boolean;
  startedAt: number | null;
  expiresAt: number | null;
}

// ============================================================================
// Events
// ============================================================================

export interface ImpersonationEventMap {
  started: { targetDisplayName: string; metadata?: Record<string, unknown> };
  stopped: { reason: "manual" | "timeout" | "orphan" };
  extended: { newExpiresAt: number };
  tick: { remainingMs: number; remainingSeconds: number };
  expiring: { remainingSeconds: number };
  expired: {};
  error: { error: Error; phase: "start" | "stop" | "extend" };
  statechange: { state: ImpersonationState };
}

export type ImpersonationEventName = keyof ImpersonationEventMap;

// ============================================================================
// Storage
// ============================================================================

/** Abstraction over sessionStorage/localStorage for SSR and testing. */
export interface StorageBackend {
  session: StorageArea;
  local: StorageArea;
}

export interface StorageArea {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULTS = {
  durationMs: 15 * 60 * 1000,        // 15 minutes
  maxDurationMs: 60 * 60 * 1000,     // 60 minutes
  storagePrefix: "impersonate",
  tickIntervalMs: 1000,
  urgentThresholdSeconds: 60,
} as const;
