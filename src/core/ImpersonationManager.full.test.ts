import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { ImpersonationManager } from "./ImpersonationManager";
import type {
  ImpersonationAdapter,
  ImpersonationResult,
  SessionSnapshot,
  StorageArea,
  StorageBackend,
  StopReason,
} from "./types";

// ── Shared helpers (reused from existing test file) ─────────────────────────

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

interface AdapterOverrides {
  restoreSession?: (snapshot: SessionSnapshot) => Promise<void>;
  clearSession?: () => Promise<void>;
  omitClearSession?: boolean;
  createImpersonatedSession?: (
    id: string
  ) => Promise<ImpersonationResult>;
  saveCurrentSession?: () => Promise<SessionSnapshot>;
}

function makeAdapter(overrides: AdapterOverrides = {}): ImpersonationAdapter & {
  saveCurrentSession: ReturnType<typeof mock>;
  createImpersonatedSession: ReturnType<typeof mock>;
  restoreSession: ReturnType<typeof mock>;
  clearSession?: ReturnType<typeof mock>;
} {
  const adapter: any = {
    saveCurrentSession: mock(
      overrides.saveCurrentSession ??
        (async (): Promise<SessionSnapshot> => ({ data: { admin: "token" } }))
    ),
    createImpersonatedSession: mock(
      overrides.createImpersonatedSession ??
        (async (id: string): Promise<ImpersonationResult> => ({
          targetDisplayName: `User ${id}`,
        }))
    ),
    restoreSession: mock(
      overrides.restoreSession ?? (async (_s: SessionSnapshot) => {})
    ),
  };
  if (!overrides.omitClearSession) {
    adapter.clearSession = mock(overrides.clearSession ?? (async () => {}));
  }
  return adapter;
}

async function startActive(
  manager: ImpersonationManager,
  targetId = "target-1"
): Promise<{ events: { name: string; data: unknown }[] }> {
  const events: { name: string; data: unknown }[] = [];
  const names = ["started", "stopped", "error", "extended"] as const;
  for (const name of names) {
    manager.on(name, (data) => events.push({ name, data }));
  }
  await manager.start(targetId);
  events.length = 0;
  return { events };
}

// Helper: collect events without starting
function collectEvents(
  manager: ImpersonationManager
): { events: { name: string; data: unknown }[] } {
  const events: { name: string; data: unknown }[] = [];
  const names = ["started", "stopped", "error", "extended", "tick", "expired"] as const;
  for (const name of names) {
    manager.on(name, (data) => events.push({ name, data }));
  }
  return { events };
}

// ── 1. start() success path ─────────────────────────────────────────────────

describe("start() success path", () => {
  test("sets status to 'active'", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    expect(manager.getState().status).toBe("idle");
    await manager.start("user-1");
    expect(manager.getState().status).toBe("active");

    manager.destroy();
  });

  test("saves snapshot via storage", async () => {
    const storage = memStorage();
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    await manager.start("user-1");

    // The storage should have the admin session and flag set
    expect(storage.session.getItem("imp_admin_session")).not.toBeNull();
    expect(storage.local.getItem("imp_impersonating")).toBe("true");

    manager.destroy();
  });

  test("starts timer (remainingMs is set)", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    expect(manager.getState().remainingMs).toBeNull();

    await manager.start("user-1");

    const remaining = manager.getState().remainingMs!;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(60_000);
    expect(manager.getState().startedAt).not.toBeNull();
    expect(manager.getState().expiresAt).not.toBeNull();

    manager.destroy();
  });

  test("emits 'started' with targetDisplayName", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    const startedEvents: unknown[] = [];
    manager.on("started", (data) => startedEvents.push(data));

    await manager.start("user-42");

    expect(startedEvents).toHaveLength(1);
    expect((startedEvents[0] as { targetDisplayName: string }).targetDisplayName).toBe(
      "User user-42"
    );

    manager.destroy();
  });

  test("targetDisplayName is set correctly in getState()", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    expect(manager.getState().targetDisplayName).toBeNull();

    await manager.start("alice");

    expect(manager.getState().targetDisplayName).toBe("User alice");

    manager.destroy();
  });

  test("passes metadata through if provided by adapter", async () => {
    const adapter = makeAdapter({
      createImpersonatedSession: async (id: string) => ({
        targetDisplayName: `User ${id}`,
        metadata: { role: "admin", email: `${id}@example.com` },
      }),
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    const startedEvents: unknown[] = [];
    manager.on("started", (data) => startedEvents.push(data));

    await manager.start("bob");

    const evt = startedEvents[0] as {
      targetDisplayName: string;
      metadata?: Record<string, unknown>;
    };
    expect(evt.metadata).toEqual({ role: "admin", email: "bob@example.com" });
    expect(manager.getState().metadata).toEqual({
      role: "admin",
      email: "bob@example.com",
    });

    manager.destroy();
  });
});

// ── 2. start() error + rollback ─────────────────────────────────────────────

describe("start() error + rollback", () => {
  test("adapter.createImpersonatedSession throws: status returns to 'idle'", async () => {
    const boom = new Error("network failure");
    const adapter = makeAdapter({
      createImpersonatedSession: async () => {
        throw boom;
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    await expect(manager.start("user-1")).rejects.toThrow("network failure");
    expect(manager.getState().status).toBe("idle");

    manager.destroy();
  });

  test("storage is cleared on start failure", async () => {
    const storage = memStorage();
    const adapter = makeAdapter({
      createImpersonatedSession: async () => {
        throw new Error("fail");
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    await expect(manager.start("user-1")).rejects.toThrow();

    expect(storage.session.getItem("imp_admin_session")).toBeNull();
    expect(storage.local.getItem("imp_impersonating")).toBeNull();

    manager.destroy();
  });

  test("timer is stopped (remainingMs is null) after start failure", async () => {
    const adapter = makeAdapter({
      createImpersonatedSession: async () => {
        throw new Error("fail");
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    await expect(manager.start("user-1")).rejects.toThrow();
    expect(manager.getState().remainingMs).toBeNull();
    expect(manager.getState().startedAt).toBeNull();
    expect(manager.getState().expiresAt).toBeNull();

    manager.destroy();
  });

  test("error event emitted with phase 'start'", async () => {
    const boom = new Error("kaboom");
    const adapter = makeAdapter({
      createImpersonatedSession: async () => {
        throw boom;
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    const errorEvents: unknown[] = [];
    manager.on("error", (data) => errorEvents.push(data));

    await expect(manager.start("user-1")).rejects.toThrow("kaboom");

    expect(errorEvents).toHaveLength(1);
    const errEvt = errorEvents[0] as { error: Error; phase: string };
    expect(errEvt.phase).toBe("start");
    expect(errEvt.error).toBe(boom);

    manager.destroy();
  });

  test("original error is re-thrown", async () => {
    const original = new Error("specific-network-error");
    const adapter = makeAdapter({
      createImpersonatedSession: async () => {
        throw original;
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    await expect(manager.start("user-1")).rejects.toBe(original);

    manager.destroy();
  });

  test("targetDisplayName is null after failure", async () => {
    const adapter = makeAdapter({
      createImpersonatedSession: async () => {
        throw new Error("fail");
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    await expect(manager.start("user-1")).rejects.toThrow();
    expect(manager.getState().targetDisplayName).toBeNull();

    manager.destroy();
  });

  test("saveCurrentSession failure also triggers rollback", async () => {
    const boom = new Error("save failed");
    const adapter = makeAdapter({
      saveCurrentSession: async () => {
        throw boom;
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    const errorEvents: unknown[] = [];
    manager.on("error", (data) => errorEvents.push(data));

    await expect(manager.start("user-1")).rejects.toBe(boom);
    expect(manager.getState().status).toBe("idle");
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0] as { phase: string }).phase).toBe("start");

    manager.destroy();
  });
});

// ── 3. start() when already active ──────────────────────────────────────────

describe("start() when already active", () => {
  test("throws error with status message", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    await manager.start("user-1");

    await expect(manager.start("user-2")).rejects.toThrow(
      /Cannot start impersonation.*active/
    );

    // Original session is still intact
    expect(manager.getState().status).toBe("active");
    expect(manager.getState().targetDisplayName).toBe("User user-1");

    manager.destroy();
  });
});

// ── 4. extend() success ─────────────────────────────────────────────────────

describe("extend() success", () => {
  test("canExtend is true initially after start", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
      maxDurationMs: 120_000,
    });

    await manager.start("user-1");

    expect(manager.getState().canExtend).toBe(true);

    manager.destroy();
  });

  test("extend() returns void (no error)", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
      maxDurationMs: 120_000,
    });

    await manager.start("user-1");

    // Should not throw
    expect(() => manager.extend()).not.toThrow();

    manager.destroy();
  });

  test("emits 'extended' event", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
      maxDurationMs: 120_000,
    });

    const { events } = await startActive(manager);

    manager.extend();

    const extendedEvents = events.filter((e) => e.name === "extended");
    expect(extendedEvents).toHaveLength(1);
    expect((extendedEvents[0].data as { newExpiresAt: number }).newExpiresAt).toBeGreaterThan(0);

    manager.destroy();
  });

  test("remainingMs increases after extend", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
      maxDurationMs: 180_000,
    });

    await manager.start("user-1");

    // Wait a bit so remainingMs decreases, then extend should bump it back up
    await new Promise((r) => setTimeout(r, 50));
    const remainingBefore = manager.getState().remainingMs!;

    manager.extend();

    const remainingAfter = manager.getState().remainingMs!;
    expect(remainingAfter).toBeGreaterThan(remainingBefore);

    manager.destroy();
  });
});

// ── 5. extend() at max duration ─────────────────────────────────────────────

describe("extend() at max duration", () => {
  test("after max extensions, canExtend becomes false", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      // Small duration so we quickly hit max
      durationMs: 50,
      maxDurationMs: 80,
    });

    await manager.start("user-1");

    // Wait enough so that elapsed > (maxDurationMs - durationMs) = 30ms
    await new Promise((r) => setTimeout(r, 50));

    expect(manager.getState().canExtend).toBe(false);

    manager.destroy();
  });

  test("extend() emits error event when cannot extend", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 50,
      maxDurationMs: 60,
    });

    const { events } = await startActive(manager);

    // Wait for elapsed > (maxDurationMs - durationMs) = 10ms
    await new Promise((r) => setTimeout(r, 30));

    // Now extend should fail
    manager.extend();

    const errorEvents = events.filter(
      (e) =>
        e.name === "error" &&
        (e.data as { phase: string }).phase === "extend"
    );
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(
      (errorEvents[0].data as { error: Error }).error.message
    ).toContain("max duration");

    manager.destroy();
  });
});

// ── 6. rehydrate() active session ───────────────────────────────────────────

describe("rehydrate() active session", () => {
  test("status is 'active' after construction with valid timer state", () => {
    const storage = memStorage();
    const now = Date.now();
    const expiresAt = now + 60_000;

    // Pre-populate storage as if a session was running
    storage.session.setItem("imp_admin_session", JSON.stringify({ admin: "token" }));
    storage.local.setItem("imp_impersonating", "true");
    storage.session.setItem("imp_start", String(now));
    storage.session.setItem("imp_expiry", String(expiresAt));
    storage.session.setItem("imp_display_name", "User rehydrated");

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    expect(manager.getState().status).toBe("active");
    expect(manager.getState().targetDisplayName).toBe("User rehydrated");
    expect(manager.getState().remainingMs).not.toBeNull();
    expect(manager.getState().remainingMs!).toBeGreaterThan(0);

    manager.destroy();
  });

  test("timer is ticking (remainingMs > 0 and decreases)", async () => {
    const storage = memStorage();
    const now = Date.now();
    const expiresAt = now + 5_000;

    storage.session.setItem("imp_admin_session", JSON.stringify({ admin: "token" }));
    storage.local.setItem("imp_impersonating", "true");
    storage.session.setItem("imp_start", String(now));
    storage.session.setItem("imp_expiry", String(expiresAt));
    storage.session.setItem("imp_display_name", "Rehydrated User");

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 5_000,
      storagePrefix: "imp",
    });

    const remaining1 = manager.getState().remainingMs!;
    expect(remaining1).toBeGreaterThan(0);

    // Wait a bit and check again
    await new Promise((r) => setTimeout(r, 100));
    const remaining2 = manager.getState().remainingMs!;
    expect(remaining2).toBeLessThanOrEqual(remaining1);

    manager.destroy();
  });

  test("rehydrated session can be stopped", async () => {
    const storage = memStorage();
    const now = Date.now();
    const expiresAt = now + 60_000;

    storage.session.setItem("imp_admin_session", JSON.stringify({ admin: "token" }));
    storage.local.setItem("imp_impersonating", "true");
    storage.session.setItem("imp_start", String(now));
    storage.session.setItem("imp_expiry", String(expiresAt));
    storage.session.setItem("imp_display_name", "Rehy User");

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    expect(manager.getState().status).toBe("active");

    const stoppedEvents: unknown[] = [];
    manager.on("stopped", (data) => stoppedEvents.push(data));

    await manager.stop("manual");

    expect(manager.getState().status).toBe("idle");
    expect(stoppedEvents).toHaveLength(1);
    expect(adapter.restoreSession).toHaveBeenCalledTimes(1);

    manager.destroy();
  });
});

// ── 7. rehydrate() expired session ──────────────────────────────────────────

describe("rehydrate() expired session", () => {
  test("status is 'idle' when timer state is in the past", () => {
    const storage = memStorage();
    const now = Date.now();
    // Expired 10 seconds ago
    const startAt = now - 70_000;
    const expiresAt = now - 10_000;

    storage.session.setItem("imp_admin_session", JSON.stringify({ admin: "token" }));
    storage.local.setItem("imp_impersonating", "true");
    storage.session.setItem("imp_start", String(startAt));
    storage.session.setItem("imp_expiry", String(expiresAt));
    storage.session.setItem("imp_display_name", "Expired User");

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    expect(manager.getState().status).toBe("idle");
    expect(manager.getState().targetDisplayName).toBeNull();

    manager.destroy();
  });

  test("storage is cleared when session is expired", () => {
    const storage = memStorage();
    const now = Date.now();
    const startAt = now - 70_000;
    const expiresAt = now - 10_000;

    storage.session.setItem("imp_admin_session", JSON.stringify({ admin: "token" }));
    storage.local.setItem("imp_impersonating", "true");
    storage.session.setItem("imp_start", String(startAt));
    storage.session.setItem("imp_expiry", String(expiresAt));
    storage.session.setItem("imp_display_name", "Expired User");

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    // Storage should have been cleared by rehydrate
    expect(storage.session.getItem("imp_admin_session")).toBeNull();
    expect(storage.local.getItem("imp_impersonating")).toBeNull();
    expect(storage.session.getItem("imp_display_name")).toBeNull();

    manager.destroy();
  });
});

// ── 8. Orphan detection ─────────────────────────────────────────────────────

describe("orphan detection", () => {
  test("checkForOrphan() returns true when localStorage flag is set but no sessionStorage", () => {
    const storage = memStorage();
    // Only set the localStorage flag, not the sessionStorage admin session
    storage.local.setItem("imp_impersonating", "true");
    // No admin_session in sessionStorage

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    expect(manager.checkForOrphan()).toBe(true);

    manager.destroy();
  });

  test("checkForOrphan() returns false when neither flag nor session exists", () => {
    const storage = memStorage();
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    expect(manager.checkForOrphan()).toBe(false);

    manager.destroy();
  });

  test("checkForOrphan() returns false when both flag and session exist (normal active)", () => {
    const storage = memStorage();
    // Both set = normal active session (not orphaned)
    storage.local.setItem("imp_impersonating", "true");
    storage.session.setItem("imp_admin_session", JSON.stringify({ admin: "token" }));

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    expect(manager.checkForOrphan()).toBe(false);

    manager.destroy();
  });

  test("after checkForOrphan() returns true, flag is cleared", () => {
    const storage = memStorage();
    storage.local.setItem("imp_impersonating", "true");

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    expect(manager.checkForOrphan()).toBe(true);
    // Flag should be gone now
    expect(storage.local.getItem("imp_impersonating")).toBeNull();

    manager.destroy();
  });

  test("second call to checkForOrphan() returns false after first clears it", () => {
    const storage = memStorage();
    storage.local.setItem("imp_impersonating", "true");

    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });

    expect(manager.checkForOrphan()).toBe(true);
    expect(manager.checkForOrphan()).toBe(false);

    manager.destroy();
  });
});

// ── 9. destroy() cleanup ────────────────────────────────────────────────────

describe("destroy() cleanup", () => {
  test("removes all listeners", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    const handler = mock(() => {});
    manager.on("tick", handler);
    manager.on("stopped", handler);
    manager.on("error", handler);

    await manager.start("user-1");

    manager.destroy();

    // After destroy, no events should fire
    handler.mockClear();

    // Force an action that would normally emit - but listeners are gone
    // We'll verify by checking the handler wasn't called after destroy
    // Since tick events are on an interval, wait a bit
    await new Promise((r) => setTimeout(r, 100));

    expect(handler).toHaveBeenCalledTimes(0);
  });

  test("stops timer (no more tick events)", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
      tickIntervalMs: 20,
    });

    const tickHandler = mock(() => {});
    manager.on("tick", tickHandler);

    await manager.start("user-1");

    // Let a couple ticks fire
    await new Promise((r) => setTimeout(r, 100));
    const tickCountBefore = tickHandler.mock.calls.length;
    expect(tickCountBefore).toBeGreaterThan(0);

    manager.destroy();
    tickHandler.mockClear();

    // Wait and verify no more ticks
    await new Promise((r) => setTimeout(r, 150));
    expect(tickHandler).toHaveBeenCalledTimes(0);
  });

  test("destroy works when idle (no-op)", () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    // Should not throw
    expect(() => manager.destroy()).not.toThrow();
  });

  test("destroy during active session stops timer and removes listeners", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });

    const handler = mock(() => {});
    manager.on("tick", handler);
    manager.on("statechange", handler);

    await manager.start("user-1");
    expect(manager.getState().status).toBe("active");

    manager.destroy();

    // Timer is stopped, listeners are gone
    // remainingMs can still be read but timer is no longer ticking
    const handler2 = mock(() => {});
    manager.on("tick", handler2);
    await new Promise((r) => setTimeout(r, 100));
    expect(handler2).toHaveBeenCalledTimes(0);
  });
});
