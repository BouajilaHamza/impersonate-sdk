import type { SessionSnapshot, StorageBackend, StorageArea } from "./types";
import { encrypt, decrypt } from "./crypto";

/** In-memory fallback for SSR / testing environments. */
class MemoryStorageArea implements StorageArea {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function createBrowserStorage(): StorageBackend {
  if (typeof window === "undefined") {
    return { session: new MemoryStorageArea(), local: new MemoryStorageArea() };
  }
  return { session: window.sessionStorage, local: window.localStorage };
}

export class StorageManager {
  private backend: StorageBackend;
  private keys: {
    adminSession: string;
    adminProfile: string;
    displayName: string;
    flag: string;
    expiry: string;
    start: string;
  };

  constructor(prefix: string, backend?: StorageBackend) {
    this.backend = backend ?? createBrowserStorage();
    this.keys = {
      adminSession: `${prefix}_admin_session`,
      adminProfile: `${prefix}_admin_profile`,
      displayName: `${prefix}_display_name`,   // sessionStorage
      flag: `${prefix}_impersonating`,         // localStorage — cross-tab
      expiry: `${prefix}_expiry`,              // sessionStorage
      start: `${prefix}_start`,                // sessionStorage
    };
  }

  // ── Session snapshot ─────────────────────────────────────────────

  async saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
    const encrypted = await encrypt(JSON.stringify(snapshot.data));
    this.backend.session.setItem(this.keys.adminSession, encrypted);
    this.backend.local.setItem(this.keys.flag, "true");
  }

  async getSnapshot(): Promise<SessionSnapshot | null> {
    const raw = this.backend.session.getItem(this.keys.adminSession);
    if (!raw) return null;
    try {
      const decrypted = await decrypt(raw);
      return { data: JSON.parse(decrypted) };
    } catch {
      // Legacy: might be unencrypted JSON from before upgrade
      try {
        return { data: JSON.parse(raw) };
      } catch {
        return null;
      }
    }
  }

  // ── Display name persistence ──────────────────────────────────────

  saveDisplayName(name: string): void {
    this.backend.session.setItem(this.keys.displayName, name);
  }

  getDisplayName(): string | null {
    return this.backend.session.getItem(this.keys.displayName);
  }

  // ── Timer persistence ────────────────────────────────────────────

  saveTimerState(startedAt: number, expiresAt: number): void {
    this.backend.session.setItem(this.keys.start, String(startedAt));
    this.backend.session.setItem(this.keys.expiry, String(expiresAt));
  }

  getTimerState(): { startedAt: number; expiresAt: number } | null {
    const start = this.backend.session.getItem(this.keys.start);
    const expiry = this.backend.session.getItem(this.keys.expiry);
    if (!start || !expiry) return null;
    return { startedAt: Number(start), expiresAt: Number(expiry) };
  }

  updateExpiry(expiresAt: number): void {
    this.backend.session.setItem(this.keys.expiry, String(expiresAt));
  }

  // ── Orphan detection ─────────────────────────────────────────────

  /**
   * Detect orphaned impersonation sessions.
   * If the localStorage flag is set but there's no admin session in
   * sessionStorage, the tab was closed during impersonation.
   */
  isOrphaned(): boolean {
    const hasFlag = this.backend.local.getItem(this.keys.flag) === "true";
    const hasSession = !!this.backend.session.getItem(this.keys.adminSession);
    return hasFlag && !hasSession;
  }

  /** Check if we were impersonating (for rehydration after page refresh). */
  hasActiveSession(): boolean {
    return !!this.backend.session.getItem(this.keys.adminSession);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  clear(): void {
    this.backend.session.removeItem(this.keys.adminSession);
    this.backend.session.removeItem(this.keys.adminProfile);
    this.backend.session.removeItem(this.keys.displayName);
    this.backend.session.removeItem(this.keys.expiry);
    this.backend.session.removeItem(this.keys.start);
    this.backend.local.removeItem(this.keys.flag);
  }

  clearOrphanFlag(): void {
    this.backend.local.removeItem(this.keys.flag);
    this.backend.session.removeItem(this.keys.displayName);
    this.backend.session.removeItem(this.keys.expiry);
    this.backend.session.removeItem(this.keys.start);
  }
}
