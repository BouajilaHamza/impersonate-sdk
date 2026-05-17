import { describe, it, expect, beforeEach } from "bun:test";
import { StorageManager } from "./StorageManager";
import { encrypt, decrypt } from "./crypto";
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

  // ── 1. saveSnapshot + getSnapshot roundtrip (encryption) ──────────────

  describe("saveSnapshot / getSnapshot", () => {
    it("round-trips encrypted snapshot data", async () => {
      const snapshot = { data: { admin: "token-abc-123" } };

      await sm.saveSnapshot(snapshot);

      // Raw stored value must NOT be plain JSON (it's encoded/encrypted)
      const raw = backend.session.getItem("impersonate_admin_session");
      expect(raw).not.toBeNull();
      expect(raw!).not.toBe(JSON.stringify(snapshot.data));
      // Must start with a recognised prefix (b64: in non-browser Bun env)
      expect(raw!).toMatch(/^(b64|enc):/);

      // getSnapshot must return the original data
      const restored = await sm.getSnapshot();
      expect(restored).not.toBeNull();
      expect(restored!.data).toEqual(snapshot.data);
    });

    // ── 2. getSnapshot with legacy plaintext data ───────────────────────

    it("reads legacy unencrypted JSON (pre-T3 fallback)", async () => {
      const legacyData = { admin: "old-token" };
      // Simulate pre-T3 data stored as raw JSON
      backend.session.setItem(
        "impersonate_admin_session",
        JSON.stringify(legacyData)
      );

      const result = await sm.getSnapshot();
      expect(result).not.toBeNull();
      expect(result!.data).toEqual(legacyData);
    });

    // ── 3. getSnapshot returns null when empty ──────────────────────────

    it("returns null when nothing is stored", async () => {
      const result = await sm.getSnapshot();
      expect(result).toBeNull();
    });
  });

  // ── 4. saveDisplayName / getDisplayName roundtrip ─────────────────────

  describe("saveDisplayName / getDisplayName", () => {
    it("round-trips a display name", () => {
      sm.saveDisplayName("Alice Example");
      expect(sm.getDisplayName()).toBe("Alice Example");
    });

    it("returns null when no display name stored", () => {
      expect(sm.getDisplayName()).toBeNull();
    });
  });

  // ── 5. saveTimerState / getTimerState roundtrip ───────────────────────

  describe("saveTimerState / getTimerState", () => {
    it("stores values as strings but returns numbers", () => {
      const startedAt = 1_700_000_000;
      const expiresAt = 1_700_000_900;

      sm.saveTimerState(startedAt, expiresAt);

      // Verify raw values are strings
      const rawStart = backend.session.getItem("impersonate_start");
      const rawExpiry = backend.session.getItem("impersonate_expiry");
      expect(rawStart).toBe("1700000000");
      expect(rawExpiry).toBe("1700000900");

      // getTimerState returns numbers
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

  // ── 6. updateExpiry ───────────────────────────────────────────────────

  describe("updateExpiry", () => {
    it("only updates the expiry key, not start", () => {
      sm.saveTimerState(100, 200);
      sm.updateExpiry(300);

      const state = sm.getTimerState();
      expect(state!.startedAt).toBe(100);
      expect(state!.expiresAt).toBe(300);
    });
  });

  // ── 7. isOrphaned detection ───────────────────────────────────────────

  describe("isOrphaned", () => {
    it("is orphaned when flag=true but no admin session", () => {
      backend.local.setItem("impersonate_impersonating", "true");
      // No session → orphaned
      expect(sm.isOrphaned()).toBe(true);
    });

    it("is not orphaned when both flag and session present", async () => {
      await sm.saveSnapshot({ data: { token: "x" } }); // sets flag + session
      expect(sm.isOrphaned()).toBe(false);
    });

    it("is not orphaned when no flag exists", () => {
      // Nothing stored → not orphaned
      expect(sm.isOrphaned()).toBe(false);
    });
  });

  // ── 8. clear() removes all keys ───────────────────────────────────────

  describe("clear", () => {
    it("removes all storage keys", async () => {
      await sm.saveSnapshot({ data: { a: 1 } });
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

  // ── 9. clearOrphanFlag() selective cleanup ────────────────────────────

  describe("clearOrphanFlag", () => {
    it("removes flag + timer/display state but NOT admin session", async () => {
      await sm.saveSnapshot({ data: { admin: "token" } });
      sm.saveDisplayName("Carol");
      sm.saveTimerState(50, 60);

      sm.clearOrphanFlag();

      // Flag removed
      expect(backend.local.getItem("impersonate_impersonating")).toBeNull();

      // Display name & timer removed
      expect(backend.session.getItem("impersonate_display_name")).toBeNull();
      expect(backend.session.getItem("impersonate_expiry")).toBeNull();
      expect(backend.session.getItem("impersonate_start")).toBeNull();

      // Admin session is preserved
      expect(
        backend.session.getItem("impersonate_admin_session")
      ).not.toBeNull();
    });
  });

  // ── 10. Encryption format (direct encrypt/decrypt tests) ──────────────

  describe("encrypt / decrypt", () => {
    it("encrypt returns a string with recognised prefix", async () => {
      const result = await encrypt("hello world");
      // In Bun (non-browser) we expect "b64:"; in browser it would be "enc:"
      expect(result).toMatch(/^(b64|enc):/);
    });

    it("decrypt reverses encrypt", async () => {
      const original = '{"user":"test","tokens":["a","b"]}';
      const encrypted = await encrypt(original);
      const decrypted = await decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it("roundtrip preserves complex data integrity", async () => {
      const data = {
        access_token: "eyJhbGciOiJIUzI1NiJ9.test",
        refresh_token: "rt_abc123",
        nested: { a: [1, 2, 3], b: true, c: null },
      };
      const json = JSON.stringify(data);
      const encrypted = await encrypt(json);
      const decrypted = await decrypt(encrypted);
      expect(JSON.parse(decrypted)).toEqual(data);
    });
  });
});
