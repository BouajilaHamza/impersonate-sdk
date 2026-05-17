import { describe, it, expect, beforeEach } from "bun:test";
import { StorageManager } from "./StorageManager";
import type { StorageArea, StorageBackend } from "./types";

// ── MemArea + memStorage helpers ────────────────────────────────────────

class MemArea implements StorageArea {
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

function memStorage(): StorageBackend {
  return { session: new MemArea(), local: new MemArea() };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("StorageManager", () => {
  let backend: StorageBackend;
  let sm: StorageManager;

  beforeEach(() => {
    backend = memStorage();
    sm = new StorageManager("impersonate", backend);
  });

  describe("saveSnapshot / getSnapshot", () => {
    it("round-trips snapshot data as plain JSON", () => {
      const snapshot = { data: { admin: "token-abc-123" } };

      sm.saveSnapshot(snapshot);

      const raw = backend.session.getItem("impersonate_admin_session");
      expect(raw).toBe(JSON.stringify(snapshot.data));

      const restored = sm.getSnapshot();
      expect(restored).not.toBeNull();
      expect(restored!.data).toEqual(snapshot.data);
    });

    it("returns null when nothing is stored", () => {
      expect(sm.getSnapshot()).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      backend.session.setItem("impersonate_admin_session", "{not json");
      expect(sm.getSnapshot()).toBeNull();
    });
  });

  describe("saveDisplayName / getDisplayName", () => {
    it("round-trips a display name", () => {
      sm.saveDisplayName("Alice Example");
      expect(sm.getDisplayName()).toBe("Alice Example");
    });

    it("returns null when no display name stored", () => {
      expect(sm.getDisplayName()).toBeNull();
    });
  });

  describe("saveTimerState / getTimerState", () => {
    it("stores values as strings but returns numbers", () => {
      const startedAt = 1_700_000_000;
      const expiresAt = 1_700_000_900;

      sm.saveTimerState(startedAt, expiresAt);

      const rawStart = backend.session.getItem("impersonate_start");
      const rawExpiry = backend.session.getItem("impersonate_expiry");
      expect(rawStart).toBe("1700000000");
      expect(rawExpiry).toBe("1700000900");

      const state = sm.getTimerState();
      expect(state).not.toBeNull();
      expect(state!.startedAt).toBe(startedAt);
      expect(state!.expiresAt).toBe(expiresAt);
      expect(typeof state!.startedAt).toBe("number");
      expect(typeof state!.expiresAt).toBe("number");
    });

    it("returns null when nothing stored", () => {
      expect(sm.getTimerState()).toBeNull();
    });
  });

  describe("updateExpiry", () => {
    it("only updates the expiry key, not start", () => {
      sm.saveTimerState(100, 200);
      sm.updateExpiry(300);

      const state = sm.getTimerState();
      expect(state!.startedAt).toBe(100);
      expect(state!.expiresAt).toBe(300);
    });
  });

  describe("isOrphaned", () => {
    it("is orphaned when flag=true but no admin session", () => {
      backend.local.setItem("impersonate_impersonating", "true");
      expect(sm.isOrphaned()).toBe(true);
    });

    it("is not orphaned when both flag and session present", () => {
      sm.saveSnapshot({ data: { token: "x" } });
      expect(sm.isOrphaned()).toBe(false);
    });

    it("is not orphaned when no flag exists", () => {
      expect(sm.isOrphaned()).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all storage keys", () => {
      sm.saveSnapshot({ data: { a: 1 } });
      sm.saveDisplayName("Bob");
      sm.saveTimerState(10, 20);

      sm.clear();

      expect(backend.session.getItem("impersonate_admin_session")).toBeNull();
      expect(backend.session.getItem("impersonate_display_name")).toBeNull();
      expect(backend.session.getItem("impersonate_start")).toBeNull();
      expect(backend.session.getItem("impersonate_expiry")).toBeNull();
      expect(backend.local.getItem("impersonate_impersonating")).toBeNull();
    });
  });

  describe("clearOrphanFlag", () => {
    it("removes flag + timer/display state but NOT admin session", () => {
      sm.saveSnapshot({ data: { admin: "token" } });
      sm.saveDisplayName("Carol");
      sm.saveTimerState(50, 60);

      sm.clearOrphanFlag();

      expect(backend.local.getItem("impersonate_impersonating")).toBeNull();

      expect(backend.session.getItem("impersonate_display_name")).toBeNull();
      expect(backend.session.getItem("impersonate_expiry")).toBeNull();
      expect(backend.session.getItem("impersonate_start")).toBeNull();

      expect(
        backend.session.getItem("impersonate_admin_session")
      ).not.toBeNull();
    });
  });
});
