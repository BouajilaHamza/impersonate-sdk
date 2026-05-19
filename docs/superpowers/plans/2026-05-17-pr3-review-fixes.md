# PR #3 Review-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the 7 review findings on PR #3 (`fix/security-hardening-and-optimisations`) and push fixes to the same branch.

**Architecture:** Drop the security-theater encryption layer entirely (cascades to fix 3 of 7 issues). Tighten audit log and migration. Document rate-limit caveat. Correct CHANGELOG.

**Tech Stack:** TypeScript SDK, Bun test runner, Deno edge function, Supabase migrations.

**Branch:** Already checked out: `fix/security-hardening-and-optimisations` tracking `upstream/fix/security-hardening-and-optimisations` (upstream = sylergydigital/impersonate-sdk). Push directly.

---

## File Structure

- **Delete:** `src/core/crypto.ts` — security theater, removed.
- **Modify:** `src/core/StorageManager.ts` — revert `saveSnapshot`/`getSnapshot` to sync plain JSON.
- **Modify:** `src/core/ImpersonationManager.ts` — drop 2 `await`s on storage calls.
- **Modify:** `src/core/StorageManager.test.ts` — remove crypto-prefix + legacy-JSON tests, revert sync.
- **Modify:** `supabase/migrations/20260517_impersonation_audit_log.sql` — drop unused `stopped_at` column.
- **Modify:** `servers/supabase/impersonate-user/index.ts` — fire-and-forget audit log + rate-limit comment.
- **Modify:** `CHANGELOG.md` — fix date, remove encryption claim, note removal.

---

### Task 1: Drop crypto + revert StorageManager to sync

**Files:**
- Delete: `src/core/crypto.ts`
- Modify: `src/core/StorageManager.ts`

- [ ] **Step 1:** Delete `src/core/crypto.ts`.

```bash
rm src/core/crypto.ts
```

- [ ] **Step 2:** Edit `src/core/StorageManager.ts`. Remove crypto import + revert snapshot methods to sync:

Remove line 2: `import { encrypt, decrypt } from "./crypto";`

Replace lines 50-70 with:

```ts
  saveSnapshot(snapshot: SessionSnapshot): void {
    this.backend.session.setItem(
      this.keys.adminSession,
      JSON.stringify(snapshot.data)
    );
    this.backend.local.setItem(this.keys.flag, "true");
  }

  getSnapshot(): SessionSnapshot | null {
    const raw = this.backend.session.getItem(this.keys.adminSession);
    if (!raw) return null;
    try {
      return { data: JSON.parse(raw) };
    } catch {
      return null;
    }
  }
```

### Task 2: Remove storage awaits in ImpersonationManager

**Files:**
- Modify: `src/core/ImpersonationManager.ts`

- [ ] **Step 1:** Line 78 — change `await this.storage.saveSnapshot(snapshot);` to `this.storage.saveSnapshot(snapshot);`.

- [ ] **Step 2:** Line 137 — change `const snapshot = await this.storage.getSnapshot();` to `const snapshot = this.storage.getSnapshot();`.

### Task 3: Update StorageManager tests

**Files:**
- Modify: `src/core/StorageManager.test.ts`

- [ ] **Step 1:** Remove `import { encrypt, decrypt } from "./crypto";`.

- [ ] **Step 2:** Replace `saveSnapshot / getSnapshot` describe block (the encrypted-roundtrip + legacy-JSON tests) with two sync tests:

```ts
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
```

### Task 4: Drop unused stopped_at column

**Files:**
- Modify: `supabase/migrations/20260517_impersonation_audit_log.sql`

- [ ] **Step 1:** Remove line `stopped_at TIMESTAMPTZ`.

### Task 5: Audit log fire-and-forget

**Files:**
- Modify: `servers/supabase/impersonate-user/index.ts`

- [ ] **Step 1:** Locate `await logImpersonation(...)`. Replace with:

```ts
      // Fire-and-forget — audit log must not block the impersonation request.
      logImpersonation(supabaseAdmin, user.id, target_user_id, targetUserName)
        .catch((err) => console.error("[impersonate-sdk] audit log failed:", err));
```

- [ ] **Step 2:** Remove the now-redundant `try/catch` inside `logImpersonation` body (caller handles it). Keep the function returning the promise.

### Task 6: Document rate-limit caveat

**Files:**
- Modify: `servers/supabase/impersonate-user/index.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1:** Above the `rateLimitMap` declaration, add comment:

```ts
// NOTE: This map lives in a single Deno isolate. Deno Deploy may spin up
// multiple isolates per region, so the effective per-admin limit is
// approximate (≤ N_isolates × RATE_LIMIT_MAX). For strict global limits,
// back this with a `rate_limit` table in Supabase.
```

- [ ] **Step 2:** Update CHANGELOG rate-limit line to call out "approximate, per Deno isolate".

### Task 7: Fix CHANGELOG date + downgrade security claims

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1:** Change `## [0.7.0] - 2025-05-17` to `## [0.7.0] - 2026-05-17`.

- [ ] **Step 2:** Remove the "Session encryption" bullet from Security section.

- [ ] **Step 3:** Add under Security:

```md
- **Encryption removed (reverted from in-PR draft):** A short-lived sessionStorage encryption layer was prototyped and then removed — the key would have lived in a JS-readable cookie alongside the encrypted blob, providing no real defense against the same XSS that would read sessionStorage. SessionStorage origin isolation remains the actual protection. See PR review for detail.
```

### Task 8: Verify, commit, push, reply on PR

- [ ] **Step 1:** Run tests:

```bash
bun test src
```

Expected: all pass (count drops by removed legacy/encrypted tests).

- [ ] **Step 2:** Commit per concern:

```bash
git add src/core/crypto.ts src/core/StorageManager.ts src/core/StorageManager.test.ts src/core/ImpersonationManager.ts
git commit -m "revert: drop sessionStorage encryption layer (security theater)"

git add supabase/migrations/20260517_impersonation_audit_log.sql
git commit -m "chore(migration): drop unused stopped_at column from audit log"

git add servers/supabase/impersonate-user/index.ts
git commit -m "fix(server): fire-and-forget audit log + document rate-limit caveat"

git add CHANGELOG.md
git commit -m "docs(changelog): fix date, downgrade security claims, note rate-limit scope"
```

- [ ] **Step 3:** Push to upstream branch:

```bash
git push upstream HEAD:fix/security-hardening-and-optimisations
```

- [ ] **Step 4:** Add a PR comment summarizing the fixes via `gh pr comment 3`.

---

## Self-Review

- All 7 review findings mapped to tasks (1+2+3 → crypto/async/dev-break; 4 → stopped_at; 5 → await; 6 → rate-limit caveat; 7 → CHANGELOG year + StorageManager async note via removal).
- No placeholders — all code blocks complete.
- Type consistency: `saveSnapshot(snapshot): void` and `getSnapshot(): SessionSnapshot | null` match call sites in ImpersonationManager.
- Push target: `upstream` remote (sylergydigital), branch name verified via `gh pr view`.
