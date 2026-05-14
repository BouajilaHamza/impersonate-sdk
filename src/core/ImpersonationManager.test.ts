import { describe, test, expect, mock } from "bun:test";
import { ImpersonationManager } from "./ImpersonationManager";
import type {
  ImpersonationAdapter,
  ImpersonationResult,
  SessionSnapshot,
  StorageArea,
  StorageBackend,
  StopReason,
} from "./types";

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
}

function makeAdapter(overrides: AdapterOverrides = {}): ImpersonationAdapter & {
  saveCurrentSession: ReturnType<typeof mock>;
  createImpersonatedSession: ReturnType<typeof mock>;
  restoreSession: ReturnType<typeof mock>;
  clearSession?: ReturnType<typeof mock>;
} {
  const adapter: any = {
    saveCurrentSession: mock(
      async (): Promise<SessionSnapshot> => ({ data: { admin: "token" } })
    ),
    createImpersonatedSession: mock(
      async (id: string): Promise<ImpersonationResult> => ({
        targetDisplayName: `User ${id}`,
      })
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
  const names = ["started", "stopped", "error"] as const;
  for (const name of names) {
    manager.on(name, (data) => events.push({ name, data }));
  }
  await manager.start(targetId);
  events.length = 0;
  return { events };
}

describe("ImpersonationManager.stop — success path", () => {
  test("manual stop emits stopped(manual) and no error", async () => {
    const adapter = makeAdapter();
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });
    const { events } = await startActive(manager);

    await manager.stop("manual");

    expect(adapter.restoreSession).toHaveBeenCalledTimes(1);
    expect(adapter.clearSession).toHaveBeenCalledTimes(0);
    const stopped = events.filter((e) => e.name === "stopped");
    const errors = events.filter((e) => e.name === "error");
    expect(stopped).toHaveLength(1);
    expect((stopped[0].data as { reason: StopReason }).reason).toBe("manual");
    expect(errors).toHaveLength(0);
    expect(manager.getState().status).toBe("idle");
  });
});

describe("ImpersonationManager.stop — failure path", () => {
  test("restoreSession throw triggers clearSession + error + stopped(restore-failed) + rethrow", async () => {
    const restoreErr = new Error("setSession network failed");
    const adapter = makeAdapter({
      restoreSession: async () => {
        throw restoreErr;
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });
    const { events } = await startActive(manager);

    await expect(manager.stop("timeout")).rejects.toBe(restoreErr);

    expect(adapter.restoreSession).toHaveBeenCalledTimes(1);
    expect(adapter.clearSession).toHaveBeenCalledTimes(1);

    const errs = events.filter((e) => e.name === "error");
    const stopped = events.filter((e) => e.name === "stopped");
    expect(errs).toHaveLength(1);
    expect((errs[0].data as { error: Error; phase: string }).phase).toBe("stop");
    expect((errs[0].data as { error: Error }).error).toBe(restoreErr);
    expect(stopped).toHaveLength(1);
    expect((stopped[0].data as { reason: StopReason }).reason).toBe(
      "restore-failed"
    );

    // error event emitted before stopped event
    const errIdx = events.findIndex((e) => e.name === "error");
    const stopIdx = events.findIndex((e) => e.name === "stopped");
    expect(errIdx).toBeLessThan(stopIdx);

    expect(manager.getState().status).toBe("idle");
    expect(manager.getState().targetDisplayName).toBeNull();
  });

  test("adapter without clearSession still emits both events on failure", async () => {
    const restoreErr = new Error("nope");
    const adapter = makeAdapter({
      restoreSession: async () => {
        throw restoreErr;
      },
      omitClearSession: true,
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });
    const { events } = await startActive(manager);

    await expect(manager.stop("timeout")).rejects.toBe(restoreErr);

    expect(events.filter((e) => e.name === "error")).toHaveLength(1);
    const stopped = events.filter((e) => e.name === "stopped");
    expect(stopped).toHaveLength(1);
    expect((stopped[0].data as { reason: StopReason }).reason).toBe(
      "restore-failed"
    );
    expect(manager.getState().status).toBe("idle");
  });

  test("clearSession throw is swallowed; events still fire", async () => {
    const restoreErr = new Error("restore boom");
    const clearErr = new Error("clear boom");
    const adapter = makeAdapter({
      restoreSession: async () => {
        throw restoreErr;
      },
      clearSession: async () => {
        throw clearErr;
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });
    const { events } = await startActive(manager);

    // Original restore error is rethrown, NOT the clearSession error
    await expect(manager.stop("timeout")).rejects.toBe(restoreErr);

    expect(adapter.clearSession).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.name === "error")).toHaveLength(1);
    expect(events.filter((e) => e.name === "stopped")).toHaveLength(1);
    expect(manager.getState().status).toBe("idle");
  });

  test("manual-stop failure also emits stopped(restore-failed)", async () => {
    const adapter = makeAdapter({
      restoreSession: async () => {
        throw new Error("x");
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 60_000,
    });
    const { events } = await startActive(manager);

    await expect(manager.stop("manual")).rejects.toThrow();

    const stopped = events.filter((e) => e.name === "stopped");
    expect(stopped).toHaveLength(1);
    expect((stopped[0].data as { reason: StopReason }).reason).toBe(
      "restore-failed"
    );
  });

  test("storage cleared after failure", async () => {
    const storage = memStorage();
    const adapter = makeAdapter({
      restoreSession: async () => {
        throw new Error("x");
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage,
      durationMs: 60_000,
      storagePrefix: "imp",
    });
    await startActive(manager);

    // Sanity: snapshot is present while active
    expect(storage.session.getItem("imp_admin_session")).not.toBeNull();
    expect(storage.local.getItem("imp_impersonating")).toBe("true");

    await expect(manager.stop("timeout")).rejects.toThrow();

    expect(storage.session.getItem("imp_admin_session")).toBeNull();
    expect(storage.local.getItem("imp_impersonating")).toBeNull();
  });
});

describe("ImpersonationManager.handleExpired wiring", () => {
  test("real timer expiry triggers stop('timeout') and emits stopped(restore-failed) on restore failure", async () => {
    const adapter = makeAdapter({
      restoreSession: async () => {
        throw new Error("backgrounded tab");
      },
    });
    const manager = new ImpersonationManager({
      adapter,
      storage: memStorage(),
      durationMs: 30, // expire fast
      tickIntervalMs: 10,
    });
    const events: { name: string; data: unknown }[] = [];
    manager.on("stopped", (d) => events.push({ name: "stopped", data: d }));
    manager.on("error", (d) => events.push({ name: "error", data: d }));

    const stoppedPromise = new Promise<void>((resolve) => {
      manager.on("stopped", () => resolve());
    });

    await manager.start("u");
    await stoppedPromise;

    const stopped = events.filter((e) => e.name === "stopped");
    expect(stopped).toHaveLength(1);
    expect((stopped[0].data as { reason: StopReason }).reason).toBe(
      "restore-failed"
    );
    expect(events.filter((e) => e.name === "error")).toHaveLength(1);
    expect(manager.getState().status).toBe("idle");
    manager.destroy();
  });
});
