# Stop-Failure Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub issue #1 — when `stop()` fails on timer expiry (typical Supabase `setSession` network failure in backgrounded tabs), SDK currently emits `error` only. Consumers without `onError` are silently left signed in as the impersonated user. SDK must defensively clear the impersonated session and emit a `stopped` event with a distinct reason so `onStop` always fires.

**Architecture:**
- Add optional `clearSession()` method to `ImpersonationAdapter` protocol — sign out the current (impersonated) auth user as a last-resort cleanup.
- In `ImpersonationManager.stop()` catch block, call `adapter.clearSession()` best-effort, then emit `stopped` with new reason `"restore-failed"` in addition to existing `error` event.
- Implement `clearSession()` in `SupabaseAdapter` via `supabase.auth.signOut()`.
- Update `ImpersonationEventMap.stopped` reason union to include `"restore-failed"`.
- Document the contract in README.

**Tech Stack:** TypeScript, Bun, tsup, Supabase JS v2 (peer).

---

## File Structure

- Modify `src/core/types.ts` — extend `ImpersonationAdapter` with optional `clearSession`; extend `stopped` reason union.
- Modify `src/core/ImpersonationManager.ts` — defensive cleanup in `stop()` catch, emit `stopped` on restore failure.
- Modify `src/adapters/supabase.ts` — implement `clearSession()` via `supabase.auth.signOut()`; add `signOut` to structural `SupabaseClient` type.
- Modify `README.md` — document `clearSession` adapter hook and the `restore-failed` reason; update `onStop` callback example.

---

### Task 1: Extend Adapter Protocol + Event Reason

**Files:**
- Modify: `src/core/types.ts:29-47` (adapter interface), `src/core/types.ts:106` (stopped event)

- [ ] **Step 1: Add `clearSession` to `ImpersonationAdapter`**

In `src/core/types.ts`, replace the `ImpersonationAdapter` interface (current lines 29-47) with:

```ts
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

  /**
   * Optional last-resort cleanup. Called by the core when `restoreSession`
   * fails inside `stop()`. Should fully sign out the currently-active
   * (impersonated) user so the client is left in a clean unauthenticated
   * state. Implementations should swallow internal errors — the core treats
   * this as best-effort.
   */
  clearSession?(): Promise<void>;
}
```

- [ ] **Step 2: Extend `stopped` reason union**

In `src/core/types.ts`, change the `stopped` line inside `ImpersonationEventMap` (current line 106) from:

```ts
  stopped: { reason: "manual" | "timeout" | "orphan" };
```

to:

```ts
  stopped: { reason: "manual" | "timeout" | "orphan" | "restore-failed" };
```

- [ ] **Step 3: Verify types compile**

Run: `bun run typecheck`
Expected: No errors. (`stop()` callers in `ImpersonationManager.ts` use string literals already in the new union; the React provider just forwards the reason.)

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(sdk): add clearSession adapter hook + restore-failed stop reason"
```

---

### Task 2: Defensive Cleanup in `ImpersonationManager.stop()`

**Files:**
- Modify: `src/core/ImpersonationManager.ts:109-154` (stop method)

- [ ] **Step 1: Rewrite the `stop()` catch block to fall back to `clearSession` and emit `stopped`**

In `src/core/ImpersonationManager.ts`, replace the entire `stop` method (current lines 109-154) with:

```ts
  async stop(reason: "manual" | "timeout" | "orphan" = "manual"): Promise<void> {
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
      // impersonated. `clearSession` is best-effort: if it also throws we
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
      // Always emit `stopped` so consumers' onStop handlers (which typically
      // redirect the user away) fire even when restore fails. The reason
      // distinguishes this from a clean stop so consumers can branch (e.g.
      // show a toast, force re-login).
      this.events.emit("stopped", { reason: "restore-failed" });
      throw error;
    }
  }
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Manual reasoning pass**

Read the new `stop()` end-to-end and confirm:
- `handleExpired()` (lines 216-222) still swallows the re-throw — fine because we already emitted both `error` and `stopped`.
- The `manual` stop path (consumer calling `stop()` from a button) also benefits: if `setSession` fails interactively, the user is still cleared.
- `clearSession` is optional — adapters that don't implement it (Generic) skip cleanly.

No code changes needed in this step; just confirm.

- [ ] **Step 4: Commit**

```bash
git add src/core/ImpersonationManager.ts
git commit -m "fix(sdk): clear session and emit stopped when restore fails (#1)"
```

---

### Task 3: Implement `clearSession` in Supabase Adapter

**Files:**
- Modify: `src/adapters/supabase.ts:14-39` (structural SupabaseClient type), `src/adapters/supabase.ts:112-126` (after `restoreSession`)

- [ ] **Step 1: Add `signOut` to the structural Supabase client type**

In `src/adapters/supabase.ts`, replace the `SupabaseClient` interface (current lines 14-39) with:

```ts
interface SupabaseClient {
  auth: {
    getSession(): Promise<{
      data: {
        session: {
          access_token: string;
          refresh_token: string;
        } | null;
      };
    }>;
    setSession(params: {
      access_token: string;
      refresh_token: string;
    }): Promise<{ error: Error | null }>;
    verifyOtp(params: {
      token_hash: string;
      type: "magiclink";
    }): Promise<{ error: Error | null }>;
    signOut(): Promise<{ error: Error | null }>;
  };
  functions: {
    invoke(
      functionName: string,
      options: { body: Record<string, unknown> }
    ): Promise<{ data: any; error: Error | null }>;
  };
}
```

- [ ] **Step 2: Implement `clearSession` on `SupabaseAdapter`**

In `src/adapters/supabase.ts`, immediately after the closing brace of `restoreSession` (currently ends at line 126) and before the class's closing `}` (currently line 127), insert:

```ts
  async clearSession(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    if (error) {
      throw new Error(`Failed to clear impersonated session: ${error.message}`);
    }
  }
```

- [ ] **Step 3: Typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: No errors. `dist/adapters/supabase.*` regenerated.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/supabase.ts
git commit -m "feat(sdk): SupabaseAdapter.clearSession via auth.signOut"
```

---

### Task 4: Document the New Behavior

**Files:**
- Modify: `README.md` — find the section that documents `onStop` and `onError` callbacks (search for `onStop` and `onError`).

- [ ] **Step 1: Find the relevant docs section**

Run: `grep -n "onStop\|onError\|stopped" README.md`
Use the output to locate the callback documentation block (likely under a "Provider props" or "Callbacks" heading).

- [ ] **Step 2: Update `onStop` reason documentation**

Wherever the README enumerates `onStop` reasons (currently `"manual" | "timeout" | "orphan"`), extend it to include `"restore-failed"`. Add a short paragraph after the list:

```md
**`"restore-failed"`** — fires when the admin session could not be restored
(typically a transient network failure on the auth backend, e.g. Supabase's
`setSession` `_getUser` call). In this case the SDK has already best-effort
cleared the impersonated session via the adapter's `clearSession` hook, so
the client is unauthenticated. Your `onStop` handler should redirect to a
safe location (login or admin home). Use `onError` (phase `"stop"`) if you
want to additionally surface a toast.
```

- [ ] **Step 3: Document the new `clearSession` adapter hook**

In the section of the README that describes the `ImpersonationAdapter` interface (search: `grep -n "saveCurrentSession\|restoreSession" README.md`), add a bullet for `clearSession`:

```md
- `clearSession?(): Promise<void>` — optional last-resort cleanup. Called by
  the core when `restoreSession` fails inside `stop()`. Should sign the
  currently-active (impersonated) user out so the client is left
  unauthenticated. Required for safe timer-expiry handling when the
  underlying auth client can make live network calls during session
  restoration. The built-in `SupabaseAdapter` implements this via
  `supabase.auth.signOut()`.
```

If there is no adapter-interface section in the README (it lives only in the source), instead add a short subsection titled `### Custom adapters: `clearSession`` near the other adapter docs with the same content reframed as guidance.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document restore-failed stop reason and clearSession adapter hook"
```

---

### Task 5: Manual Verification + Release

**Files:**
- Modify: `package.json` (version bump)

- [ ] **Step 1: Run typecheck + build clean**

Run: `bun run typecheck && bun run build`
Expected: Exit code 0, `dist/` regenerated.

- [ ] **Step 2: Smoke-check the built output**

Run: `grep -l "restore-failed" dist/core/*.js dist/core/*.d.ts`
Expected: Match in compiled core output. Confirms the new reason flows through tsup.

Run: `grep -l "clearSession" dist/adapters/supabase.js dist/adapters/supabase.d.ts dist/core/types.d.ts`
Expected: Matches in all three. Confirms adapter + types ship.

- [ ] **Step 3: Bump version + commit**

In `package.json:3`, change `"version": "0.5.0"` to `"version": "0.5.1"`.

```bash
git add package.json
git commit -m "chore(release): v0.5.1"
```

- [ ] **Step 4: Close GH issue with explanation**

```bash
gh issue comment 1 --body "Fixed at SDK level in v0.5.1:

- New optional \`clearSession\` adapter hook. \`SupabaseAdapter\` implements it via \`auth.signOut()\`.
- When \`stop()\` fails to restore the admin session (the \`setSession\` → \`_getUser\` network failure described in the RCA), the core now best-effort calls \`adapter.clearSession()\` so the client is no longer impersonated.
- The core emits a \`stopped\` event with new reason \`\"restore-failed\"\` (in addition to the existing \`error\` event) so \`onStop\` handlers fire and the consumer's redirect logic runs even when no \`onError\` is wired up.

Consumers can now keep their existing \`onError\` for toasts, but the silent-impersonation failure mode is gone even when only \`onStop\` is wired.
"
gh issue close 1
```

---

## Self-Review

**Spec coverage:**
- RCA cause #1 (live `_getUser` call): can't fix in SDK (Supabase JS internal). Mitigated by Task 2 + Task 3 — best-effort sign-out leaves a safe state.
- RCA cause #2 (no `onError` handler in consumer): Task 2 makes the SDK robust to this by emitting `stopped` regardless, so `onStop` alone is enough for the redirect path.
- Files Changed table in RCA was consumer-side (App.tsx). This plan keeps the consumer-side guidance optional via README and fixes the root SDK behavior so future consumers don't trip on the same gap.

**Placeholder scan:** None. Every code step shows the exact replacement. README step has one conditional branch (section may or may not exist) but both branches are concrete.

**Type consistency:**
- `clearSession?(): Promise<void>` — same shape in adapter interface (Task 1) and Supabase impl (Task 3).
- `"restore-failed"` — added to `stopped` reason union in Task 1, emitted in Task 2, documented in Task 4.
- `signOut(): Promise<{ error: Error | null }>` — matches Supabase JS v2 signature; consistent with sibling methods in the structural type.
