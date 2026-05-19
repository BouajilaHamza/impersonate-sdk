# Two-Phase Stop Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the destructive `restore-failed` stop path with a recoverable two-phase rollback. By default, when `restoreSession()` throws, the manager preserves the saved admin snapshot, enters a new `stop-failed` status, and exposes a `retryStop()` API. Forced logout becomes an explicit caller opt-in.

**Architecture:** Add `"stop-failed"` to `ImpersonationStatus`. Change `stop()` to take `{ forceClearOnFailure?: boolean }`. Add `retryStop(reason?)`. Treat the failure path as a state, not a terminal event — `stopped` only fires when state actually returns to `idle`. Keep the nuclear path available via the explicit option so consumers who relied on the old behavior can opt back in.

**Tech Stack:** TypeScript, `bun:test` (unit), Playwright (E2E), React (consumer hook).

---

## File Structure

- `src/core/types.ts` — **modified**: extend `ImpersonationStatus`, extend `stop()` signature, add `StopOptions`, add new event `recoverable` (optional, see Task 4).
- `src/core/ImpersonationManager.ts` — **modified**: rewrite `stop()` catch block, add `retryStop()`, surface stop-failed state.
- `src/react/useImpersonation.ts` — **modified**: expose `isStopFailed`, `retryStop`, `forceStop` helpers.
- `src/react/ImpersonationProvider.tsx` — **modified**: pass through new state and pipe new error semantics into the existing `onError`/`onStop` callbacks; document the breaking change.
- `src/core/ImpersonationManager.test.ts` — **modified**: rewrite existing failure-path tests and add new ones for retry/force.
- `test/e2e/stop-restore-failed.spec.ts` — **modified**: update Playwright expectations to match the new contract.
- `README.md` (or the relevant docs page) — **modified**: document migration and the new API.

---

### Task 1: Add `stop-failed` status and `StopOptions` to types

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Extend `ImpersonationStatus`**

Replace line 95:

```typescript
export type ImpersonationStatus =
  | "idle"
  | "starting"
  | "active"
  | "stopping"
  | "stop-failed";
```

- [ ] **Step 2: Add `StopOptions` and export**

After the `StopReason` declaration (around line 114), add:

```typescript
export interface StopOptions {
  /**
   * If `true` and `restoreSession()` throws, the manager will call
   * `adapter.clearSession()`, wipe storage, and emit `stopped("restore-failed")`
   * — the legacy destructive behavior. Default `false`: the manager preserves
   * the snapshot, enters `stop-failed`, and lets the caller `retryStop()` or
   * explicitly `forceStop()` later.
   */
  forceClearOnFailure?: boolean;
}
```

- [ ] **Step 3: Update `error` event to include `canRetry`**

Replace the `error` line inside `ImpersonationEventMap`:

```typescript
error: {
  error: Error;
  phase: "start" | "stop" | "extend";
  canRetry?: boolean;
};
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: passes — no consumers reference `stop-failed` yet, so this is additive.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): add stop-failed status and StopOptions"
```

---

### Task 2: Rewrite `stop()` failure path — recoverable by default

**Files:**
- Modify: `src/core/ImpersonationManager.ts`

- [ ] **Step 1: Update the `stop()` signature and JSDoc**

Replace lines 110–183 (the entire JSDoc block plus the `stop` method) with:

```typescript
  /**
   * End the current impersonation session and restore the admin session.
   *
   * On success: emits `stopped` with the given reason and returns the manager
   * to `idle`.
   *
   * On failure (default — `options.forceClearOnFailure` is false or omitted):
   * the snapshot is preserved, status becomes `"stop-failed"`, an `error`
   * event fires with `phase: "stop"` and `canRetry: true`, and the error is
   * re-thrown. No `stopped` event is emitted because cleanup did not succeed.
   * The caller may invoke `retryStop()` (recommended) or
   * `stop(reason, { forceClearOnFailure: true })` to force a destructive
   * cleanup.
   *
   * On failure (`options.forceClearOnFailure: true`): the manager calls
   * `adapter.clearSession()` (best-effort), wipes storage, emits both
   * `error` and `stopped("restore-failed")`, returns to `idle`, and re-throws.
   * This is the legacy v0.6 and earlier behavior.
   */
  async stop(
    reason: StopReason = "manual",
    options: StopOptions = {},
  ): Promise<void> {
    if (this.status === "stop-failed") {
      // Caller is invoking stop() again while we're in the failed state.
      // Treat as an explicit retry attempt.
      return this.retryStop(reason, options);
    }

    if (this.status !== "active" && reason !== "orphan") {
      if (this.status === "idle") return;
      throw new Error(
        `Cannot stop impersonation: current status is "${this.status}".`,
      );
    }

    this.setStatus("stopping");
    await this.performRestoreAndCleanup(reason, options);
  }

  /**
   * Retry the restore phase from `"stop-failed"`. Uses the retained snapshot.
   * On success, returns to `idle` and emits `stopped(reason)`.
   * On failure, remains in `"stop-failed"` and re-throws (or, if
   * `forceClearOnFailure` is set, performs the destructive cleanup).
   */
  async retryStop(
    reason: StopReason = "manual",
    options: StopOptions = {},
  ): Promise<void> {
    if (this.status !== "stop-failed") {
      throw new Error(
        `retryStop() requires status "stop-failed"; current status is "${this.status}".`,
      );
    }
    this.setStatus("stopping");
    await this.performRestoreAndCleanup(reason, options);
  }
```

- [ ] **Step 2: Extract the shared restore/cleanup logic into a private method**

Insert just below `retryStop`, replacing the original try/catch body:

```typescript
  private async performRestoreAndCleanup(
    reason: StopReason,
    options: StopOptions,
  ): Promise<void> {
    try {
      this.timer.stop();

      const snapshot = this.storage.getSnapshot();
      if (snapshot) {
        if (this.adapter.destroyImpersonatedSession) {
          await this.adapter.destroyImpersonatedSession();
        }
        await this.adapter.restoreSession(snapshot);
      }

      this.storage.clear();
      this.targetDisplayName = null;
      this.metadata = null;
      this.setStatus("idle");
      this.events.emit("stopped", { reason });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (options.forceClearOnFailure) {
        // Legacy destructive path: nuke the session, emit both events.
        if (this.adapter.clearSession) {
          try {
            await this.adapter.clearSession();
          } catch {
            // swallow — already in error path
          }
        }
        this.storage.clear();
        this.timer.stop();
        this.targetDisplayName = null;
        this.metadata = null;
        this.setStatus("idle");
        this.events.emit("error", { error, phase: "stop", canRetry: false });
        this.events.emit("stopped", { reason: "restore-failed" });
        throw error;
      }

      // Recoverable path: preserve snapshot, enter stop-failed.
      this.timer.stop();
      this.setStatus("stop-failed");
      this.events.emit("error", { error, phase: "stop", canRetry: true });
      throw error;
    }
  }
```

- [ ] **Step 3: Update the `handleExpired` private helper**

Replace lines 245–251 with:

```typescript
  private async handleExpired(): Promise<void> {
    try {
      await this.stop("timeout");
    } catch {
      // Either restore failed (status is now "stop-failed") or forceClear
      // path threw. Either way, `error` has already been emitted.
    }
  }
```

(The signature is the same; the difference is the comment correctly reflects the new behavior.)

- [ ] **Step 4: Import the new `StopOptions` type**

At the top of `src/core/ImpersonationManager.ts`, extend the type import (line 4-13):

```typescript
import type {
  ImpersonationAdapter,
  ImpersonationConfig,
  ImpersonationState,
  ImpersonationStatus,
  ImpersonationEventMap,
  ImpersonationEventName,
  StopReason,
  StopOptions,
  DEFAULTS as DefaultsType,
} from "./types";
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 6: Commit (no test run yet — existing tests will break in Task 3)**

```bash
git add src/core/ImpersonationManager.ts
git commit -m "feat(core): two-phase stop with recoverable stop-failed state"
```

---

### Task 3: Update existing unit tests for the new contract

**Files:**
- Modify: `src/core/ImpersonationManager.test.ts`

- [ ] **Step 1: Find and read the existing failure-path tests**

Run: `grep -n "restore-failed\|clearSession\|stop-failed\|forceClear" src/core/ImpersonationManager.test.ts`

Open the matched tests (lines 98–187 per the exploration report) and replace them as below. Keep all other tests untouched.

- [ ] **Step 2: Replace the "restore-failed default emits both events" test**

The old test asserted: error event + stopped("restore-failed") + clearSession called. New contract: error event (canRetry=true) + status "stop-failed" + snapshot retained + no stopped event + clearSession NOT called.

```typescript
test("restore failure: default path is recoverable", async () => {
  const adapter = makeAdapter();
  adapter.restoreSession = mock(async () => {
    throw new Error("network down");
  });

  const manager = new ImpersonationManager({ adapter });
  await manager.start(TARGET_USER_ID);

  const events: any[] = [];
  manager.on("error", (e) => events.push({ kind: "error", ...e }));
  manager.on("stopped", (e) => events.push({ kind: "stopped", ...e }));

  await expect(manager.stop()).rejects.toThrow("network down");

  expect(manager.getState().status).toBe("stop-failed");
  expect(adapter.clearSession).not.toHaveBeenCalled();
  expect(events.find((e) => e.kind === "stopped")).toBeUndefined();
  const errEvent = events.find((e) => e.kind === "error");
  expect(errEvent.phase).toBe("stop");
  expect(errEvent.canRetry).toBe(true);
});
```

- [ ] **Step 3: Add test — `retryStop` recovers**

```typescript
test("retryStop succeeds after restoreSession recovers", async () => {
  const adapter = makeAdapter();
  let calls = 0;
  adapter.restoreSession = mock(async () => {
    calls += 1;
    if (calls === 1) throw new Error("transient");
  });

  const manager = new ImpersonationManager({ adapter });
  await manager.start(TARGET_USER_ID);
  await expect(manager.stop()).rejects.toThrow("transient");
  expect(manager.getState().status).toBe("stop-failed");

  const stopEvents: any[] = [];
  manager.on("stopped", (e) => stopEvents.push(e));

  await manager.retryStop();
  expect(manager.getState().status).toBe("idle");
  expect(stopEvents).toEqual([{ reason: "manual" }]);
  expect(adapter.clearSession).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Add test — `retryStop` from non-failed state throws**

```typescript
test("retryStop throws when not in stop-failed", async () => {
  const manager = new ImpersonationManager({ adapter: makeAdapter() });
  await expect(manager.retryStop()).rejects.toThrow(/requires status "stop-failed"/);
});
```

- [ ] **Step 5: Add test — `stop({ forceClearOnFailure: true })` preserves legacy behavior**

```typescript
test("forceClearOnFailure runs legacy destructive cleanup", async () => {
  const adapter = makeAdapter();
  adapter.restoreSession = mock(async () => {
    throw new Error("permanent");
  });
  adapter.clearSession = mock(async () => {});

  const manager = new ImpersonationManager({ adapter });
  await manager.start(TARGET_USER_ID);

  const events: any[] = [];
  manager.on("error", (e) => events.push({ kind: "error", ...e }));
  manager.on("stopped", (e) => events.push({ kind: "stopped", ...e }));

  await expect(
    manager.stop("manual", { forceClearOnFailure: true }),
  ).rejects.toThrow("permanent");

  expect(adapter.clearSession).toHaveBeenCalledTimes(1);
  expect(manager.getState().status).toBe("idle");
  const stopped = events.find((e) => e.kind === "stopped");
  expect(stopped.reason).toBe("restore-failed");
  const err = events.find((e) => e.kind === "error");
  expect(err.canRetry).toBe(false);
});
```

- [ ] **Step 6: Update the "adapter without clearSession" test**

Reframe: when adapter lacks `clearSession` AND caller passes `forceClearOnFailure: true`, the manager still emits `stopped("restore-failed")` and returns to `idle`. Old test asserted the same emissions for the default path — that assertion is gone now.

```typescript
test("forceClearOnFailure works without adapter.clearSession", async () => {
  const adapter = makeAdapter();
  adapter.restoreSession = mock(async () => {
    throw new Error("permanent");
  });
  delete adapter.clearSession;

  const manager = new ImpersonationManager({ adapter });
  await manager.start(TARGET_USER_ID);

  const stops: any[] = [];
  manager.on("stopped", (e) => stops.push(e));

  await expect(
    manager.stop("manual", { forceClearOnFailure: true }),
  ).rejects.toThrow("permanent");

  expect(stops).toEqual([{ reason: "restore-failed" }]);
  expect(manager.getState().status).toBe("idle");
});
```

- [ ] **Step 7: Update the "clearSession error swallowed" test**

Same shape as the existing test, but now requires `forceClearOnFailure: true` to enter the path.

```typescript
test("clearSession error is swallowed under forceClearOnFailure", async () => {
  const adapter = makeAdapter();
  adapter.restoreSession = mock(async () => {
    throw new Error("original");
  });
  adapter.clearSession = mock(async () => {
    throw new Error("cleanup also broken");
  });

  const manager = new ImpersonationManager({ adapter });
  await manager.start(TARGET_USER_ID);

  await expect(
    manager.stop("manual", { forceClearOnFailure: true }),
  ).rejects.toThrow("original");
  expect(manager.getState().status).toBe("idle");
});
```

- [ ] **Step 8: Update the timer-expiry test**

The existing test (around lines 237–269) asserted timer-driven `stop("timeout")` triggered `restore-failed`. New contract: timer expiry leaves the manager in `stop-failed` because default behavior is recoverable.

```typescript
test("timer expiry into restore failure leaves manager in stop-failed", async () => {
  const adapter = makeAdapter();
  adapter.restoreSession = mock(async () => {
    throw new Error("expired-restore");
  });

  const manager = new ImpersonationManager({
    adapter,
    durationMs: 50,
    tickIntervalMs: 20,
  });
  await manager.start(TARGET_USER_ID);

  await new Promise((r) => setTimeout(r, 200));

  expect(manager.getState().status).toBe("stop-failed");
  expect(adapter.clearSession).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Run tests**

Run: `bun test src/core/ImpersonationManager.test.ts`
Expected: PASS — all replaced tests green, untouched success-path tests still green.

- [ ] **Step 10: Commit**

```bash
git add src/core/ImpersonationManager.test.ts
git commit -m "test(core): two-phase stop with retryStop and forceClearOnFailure"
```

---

### Task 4: Surface the new state in the React hook

**Files:**
- Modify: `src/react/useImpersonation.ts`

- [ ] **Step 1: Read the current hook to find the return-object shape**

Run: `cat src/react/useImpersonation.ts`
Locate the returned object (around lines 18–68 per the exploration report).

- [ ] **Step 2: Add `isStopFailed`, `retryStop`, `forceStop`**

Extend the returned object with these fields. The exact insertion point is just after `isTransitioning` and just before the existing `stop` callback:

```typescript
isStopFailed: state.status === "stop-failed",
retryStop: useCallback(
  () => manager.retryStop(),
  [manager],
),
forceStop: useCallback(
  () => manager.stop("manual", { forceClearOnFailure: true }),
  [manager],
),
```

If the hook does not currently import `useCallback`, add it to the React import line at the top of the file.

Also update the existing `isTransitioning` to include the new status:

```typescript
isTransitioning:
  state.status === "starting" ||
  state.status === "stopping" ||
  state.status === "stop-failed",
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/react/useImpersonation.ts
git commit -m "feat(react): expose isStopFailed, retryStop, forceStop on hook"
```

---

### Task 5: Update Playwright E2E for the new contract

**Files:**
- Modify: `test/e2e/stop-restore-failed.spec.ts`

- [ ] **Step 1: Replace the "restore-failed redirect" test**

Old behavior: timer expires → restore fails → clearSession runs → redirect to `/login?session_lost=1`.

New default: timer expires → restore fails → app surfaces `isStopFailed` banner with a Retry button. The test should now drive the Retry flow.

```typescript
test("recoverable stop-failed state exposes Retry button", async ({ page }) => {
  await page.goto("/admin");
  await loginAsAdmin(page);
  await startImpersonationOf(page, TEST_USER_ID);

  await stubRestoreToFail(page);

  // Wait for the impersonation timer to expire and the restore attempt to fail.
  await page.waitForSelector('[data-testid="impersonation-stop-failed-banner"]', {
    timeout: 10_000,
  });

  await expect(page).toHaveURL(/\/admin/); // still on admin, no forced sign-out
  await expect(page.locator('[data-testid="retry-stop"]')).toBeVisible();

  await unstubRestore(page);
  await page.click('[data-testid="retry-stop"]');

  await page.waitForSelector('[data-testid="impersonation-stop-failed-banner"]', {
    state: "detached",
  });
});
```

If the test harness app does not yet render a banner + retry button for `isStopFailed`, add the minimal UI in the existing test fixture file (see existing patterns under `test/e2e/fixtures/` or wherever the test app lives — run `grep -rln "impersonation-stopped-banner\|useImpersonation" test/e2e/` to locate it).

- [ ] **Step 2: Add an explicit forceStop test**

```typescript
test("forceStop performs destructive cleanup and redirects", async ({ page }) => {
  await page.goto("/admin");
  await loginAsAdmin(page);
  await startImpersonationOf(page, TEST_USER_ID);

  await stubRestoreToFail(page);

  await page.waitForSelector('[data-testid="impersonation-stop-failed-banner"]');
  await page.click('[data-testid="force-stop"]');

  await page.waitForURL(/\/login\?session_lost=1/);
});
```

Wire a `<button data-testid="force-stop" onClick={forceStop}>` into the same banner.

- [ ] **Step 3: Update the success-path test**

The existing success test (no redirect, no clearSession) should still pass. Re-run it to confirm.

- [ ] **Step 4: Run E2E**

Run: `bun run test:e2e`
Expected: all e2e tests green.

- [ ] **Step 5: Commit**

```bash
git add test/e2e/stop-restore-failed.spec.ts test/e2e/fixtures
git commit -m "test(e2e): cover stop-failed recovery and forceStop paths"
```

---

### Task 6: Document the breaking change

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md` (if present — otherwise add the migration note to README)

- [ ] **Step 1: Locate the stop() / onStop documentation**

Run: `grep -n "onStop\|restore-failed\|stop()" README.md | head -30`

- [ ] **Step 2: Add a migration section**

Insert under the relevant heading:

```markdown
### Migration: stop-failed state (v0.7)

Prior to v0.7, when `restoreSession()` threw inside `stop()`, the SDK would:
1. call `adapter.clearSession()` to sign the user out,
2. emit `error` (phase `"stop"`),
3. emit `stopped("restore-failed")`,
4. re-throw the original error.

That meant a transient network failure during stop forced the admin to log in
again. From v0.7, the default behavior is recoverable:

1. `error` is emitted with `phase: "stop"` and `canRetry: true`,
2. the manager enters status `"stop-failed"`,
3. the saved admin snapshot is **preserved**,
4. no `stopped` event is emitted,
5. the error is re-thrown.

Call `manager.retryStop()` (or the `retryStop` function exposed by
`useImpersonation()`) to re-attempt the restore. To preserve the v0.6 behavior
explicitly, pass `forceClearOnFailure: true`:

```typescript
await manager.stop("manual", { forceClearOnFailure: true });
```

The React hook exposes a matching `forceStop()` helper.
```

- [ ] **Step 3: Bump package.json version**

Edit `package.json` `"version"` to the next minor (e.g. `0.7.0`).

- [ ] **Step 4: Commit**

```bash
git add README.md package.json CHANGELOG.md 2>/dev/null
git commit -m "docs: document v0.7 stop-failed migration; bump version"
```

---

## Self-Review Notes

- **Spec coverage:** Codex asked for a recoverable error state, preservation of pre-impersonation session until restore succeeds, and explicit caller opt-in for forced cleanup. Task 2 implements the recoverable path; Task 3 verifies snapshot retention and the explicit opt-in; Tasks 4–5 surface it through the public API and E2E.
- **Placeholder scan:** every test contains actual mock setup and assertion code; no "add appropriate error handling" placeholders remain.
- **Type consistency:** `stop()` and `retryStop()` share the same `(reason: StopReason, options: StopOptions)` signature; the `error` event always includes `canRetry: boolean` in the new contract; `isStopFailed` in React maps directly to `status === "stop-failed"` from the manager.
- **Out of scope:** persisting the snapshot across page reloads when in `stop-failed`. The current StorageManager already persists `adminSession` to `sessionStorage`; the existing `rehydrate()` path will need a follow-up if we want stop-failed to survive a refresh, but that is a separate plan.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-two-phase-stop-rollback.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — batch execution with checkpoints.
