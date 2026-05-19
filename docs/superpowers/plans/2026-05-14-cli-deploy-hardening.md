# CLI Deploy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the wrong-project deployment hazard in `impersonate-sdk deploy`. Resolve the target project ref from the Supabase CLI, show it explicitly, require confirmation, persist a `# managed: impersonate-sdk project: <ref>` marker, and abort on mismatch unless `--force` is passed. Add unit tests covering multi-project workspaces, stale env, reruns, and partial failures.

**Architecture:** Inject the Supabase runner so tests do not spawn real subprocesses. Read the linked project ref both from disk (existing `getSupabaseProjectRef`) and from `supabase projects list --output json` to cross-check. Always print the project name + ref before mutation. Stamp `supabase/.env` with a managed marker that pins the project ref; refuse to overwrite a different one without `--force`.

**Tech Stack:** TypeScript, Node.js, `bun:test` (unit), Supabase CLI.

---

## File Structure

- `src/cli/supabase.ts` — **modified**: export a `SupabaseRunner` type so callers can inject a fake; add `getLinkedProjects(runner, cwd)` helper.
- `src/cli/commands/deploy.ts` — **modified**: accept an optional `deps: { runner: SupabaseRunner }` parameter; resolve + confirm project ref; check the `.env` marker; honor `--force`.
- `src/cli/index.ts` — **modified**: parse `--force` flag and pass through to `runDeploy`.
- `src/cli/envfile.ts` — **modified**: read/write a `# impersonate-sdk:project=<ref>` marker on managed env files; add `readManagedProjectRef(cwd)`.
- `src/cli/commands/deploy.test.ts` — **new**: bun unit tests covering ref resolution, mismatch, rerun, partial failure.
- `package.json` — **modified**: nothing scripted, but bump version since `--force` is a public-surface change.

---

### Task 1: Export a `SupabaseRunner` type and add a JSON-projects helper

**Files:**
- Modify: `src/cli/supabase.ts`

- [ ] **Step 1: Add the runner type**

After the `RunResult` interface, add:

```typescript
export type SupabaseRunner = (
  args: string[],
  opts: { cwd: string; stream?: boolean },
) => Promise<RunResult>;
```

Make the existing `runSupabase` satisfy that type (it already does — no signature change required).

- [ ] **Step 2: Add `getLinkedProjectRefFromCli`**

Append:

```typescript
export interface LinkedProject {
  ref: string;
  name: string;
  linked: boolean;
}

/**
 * Ask the Supabase CLI for the list of projects and pick the one whose `linked`
 * flag is true. Returns `null` if no linked project is reported.
 */
export async function getLinkedProjectFromCli(
  cwd: string,
  runner: SupabaseRunner = runSupabase,
): Promise<LinkedProject | null> {
  const res = await runner(["projects", "list", "--output", "json"], { cwd });
  if (res.code !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const found = parsed.find(
    (p: any) => p && typeof p === "object" && p.linked === true,
  );
  if (!found) return null;
  return {
    ref: String(found.id ?? found.ref ?? ""),
    name: String(found.name ?? ""),
    linked: true,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/cli/supabase.ts
git commit -m "feat(cli): expose SupabaseRunner type and getLinkedProjectFromCli"
```

---

### Task 2: Read/write the managed project-ref marker in `supabase/.env`

**Files:**
- Modify: `src/cli/envfile.ts`

- [ ] **Step 1: Read existing `envfile.ts` to find the marker pattern**

Run: `cat src/cli/envfile.ts`

It already uses a `# managed by impersonate-sdk` style comment as a marker for the managed block (see exploration report lines 26–52). We will extend the marker to include the project ref.

- [ ] **Step 2: Add `readManagedProjectRef` and `writeManagedProjectRef`**

Append (or splice into the existing managed-marker logic):

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_MARKER_RE = /^#\s*impersonate-sdk:project=([a-z0-9-]+)\s*$/im;

export function readManagedProjectRef(cwd: string): string | null {
  const path = join(cwd, "supabase", ".env");
  if (!existsSync(path)) return null;
  const contents = readFileSync(path, "utf8");
  const match = contents.match(PROJECT_MARKER_RE);
  return match ? match[1] : null;
}
```

Then update the existing `writeManagedEnv` (the helper that writes `supabase/.env`) to accept a `projectRef` argument and prepend the marker line above the managed block:

```typescript
// In writeManagedEnv, when assembling the managed section:
const managedHeader = projectRef
  ? `# impersonate-sdk:project=${projectRef}\n# managed by impersonate-sdk (do not edit between markers)\n`
  : `# managed by impersonate-sdk (do not edit between markers)\n`;
```

If the existing managed section already contains a `# impersonate-sdk:project=...` line for a different ref, leave it for the caller (deploy.ts) to detect; the writer simply overwrites with the new ref.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/cli/envfile.ts
git commit -m "feat(cli): stamp managed env with project ref marker"
```

---

### Task 3: Make `runDeploy` accept an injected runner and a `force` flag

**Files:**
- Modify: `src/cli/commands/deploy.ts`

- [ ] **Step 1: Update the `runDeploy` signature**

Replace lines 17–22 of `deploy.ts`:

```typescript
import type { SupabaseRunner } from "../supabase";
import {
  checkSupabaseInstalled,
  checkLoggedIn,
  runSupabase,
  getLinkedProjectFromCli,
} from "../supabase";
import { configToEnv, readManagedProjectRef } from "../envfile";

export interface DeployDeps {
  runner: SupabaseRunner;
}

export async function runDeploy(
  opts: {
    cwd: string;
    dryRun: boolean;
    yes: boolean;
    force: boolean;
  },
  deps: DeployDeps = { runner: runSupabase },
): Promise<number> {
  const { cwd, dryRun, yes, force } = opts;
  const runner = deps.runner;
```

(Keep the rest of the body for now; subsequent steps replace pieces of it.)

- [ ] **Step 2: Replace the preflight calls to use the injected runner**

Wherever `checkSupabaseInstalled(cwd)`, `checkLoggedIn(cwd)`, and `runSupabase(...)` are called in `deploy.ts`, pass `runner` through. Update the helpers in `src/cli/supabase.ts` accordingly:

```typescript
// src/cli/supabase.ts
export async function checkSupabaseInstalled(
  cwd: string,
  runner: SupabaseRunner = runSupabase,
): Promise<boolean> {
  const { code } = await runner(["--version"], { cwd });
  return code === 0;
}

export async function checkLoggedIn(
  cwd: string,
  runner: SupabaseRunner = runSupabase,
): Promise<boolean> {
  const { code } = await runner(["projects", "list"], { cwd });
  return code === 0;
}
```

And in deploy.ts:

```typescript
if (!dryRun) {
  const installed = await checkSupabaseInstalled(cwd, runner);
  // ...
  const loggedIn = await checkLoggedIn(cwd, runner);
  // ...
}
```

- [ ] **Step 3: Resolve project ref from both sources and cross-check**

Replace the current "Preview" block (lines 78–87) with:

```typescript
const diskRef = getSupabaseProjectRef(cwd);
const cliProject = await getLinkedProjectFromCli(cwd, runner);
const cliRef = cliProject?.ref ?? null;

if (diskRef && cliRef && diskRef !== cliRef) {
  process.stderr.write(
    `Project ref mismatch:\n` +
      `  on disk:        ${diskRef}\n` +
      `  supabase CLI:   ${cliRef}\n` +
      `Fix by relinking (supabase link --project-ref ${cliRef}) or remove the stale cache.\n`,
  );
  return 1;
}

const projectRef = cliRef ?? diskRef;
if (!projectRef) {
  process.stderr.write(
    "Could not determine the linked project ref.\n" +
      "Run `supabase link --project-ref <ref>` first.\n",
  );
  return 1;
}

const managedRef = readManagedProjectRef(cwd);
if (managedRef && managedRef !== projectRef && !force) {
  process.stderr.write(
    `Refusing to deploy: supabase/.env was last managed for project ${managedRef}, ` +
      `but the linked project is now ${projectRef}.\n` +
      `Re-run with --force if this change is intentional.\n`,
  );
  return 1;
}

const label = cliProject?.name ? `${cliProject.name} (${projectRef})` : projectRef;
process.stdout.write(`• target:  ${label}\n\n`);
process.stdout.write("Will run:\n");
const secretArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
process.stdout.write(`  supabase secrets set ${secretArgs.join(" ")}\n`);
process.stdout.write(`  supabase functions deploy ${FUNCTION_NAME}\n\n`);
```

- [ ] **Step 4: Replace the unconditional `confirm()` with project-ref confirmation**

Replace the existing `if (!yes) { ... confirm("Proceed?", false) ... }` block with:

```typescript
if (!dryRun && !yes) {
  process.stdout.write(
    `About to deploy to ${label}. This will overwrite secrets and the function.\n`,
  );
  const ok = await confirm(`Type 'y' to deploy to ${projectRef}:`, false);
  if (!ok) {
    process.stdout.write("Aborted.\n");
    return 1;
  }
}
```

- [ ] **Step 5: Pipe `runner` into the `runSupabase` call sites**

Replace the two `runSupabase([...], { cwd, stream: true })` lines (around 106 and 117) with:

```typescript
const secretsResult = await runner(
  ["secrets", "set", ...secretArgs],
  { cwd, stream: true },
);
// ...
const deployResult = await runner(
  ["functions", "deploy", FUNCTION_NAME],
  { cwd, stream: true },
);
```

- [ ] **Step 6: Stamp the marker after a successful deploy**

After both `runner(...)` calls succeed, persist the project ref:

```typescript
// After successful function deploy, before the smoke-test print:
const { writeManagedEnv } = await import("../envfile");
writeManagedEnv(cwd, env, projectRef);
```

(If `writeManagedEnv` is already being called earlier in the file, pass `projectRef` through there instead — do not double-write.)

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/deploy.ts src/cli/supabase.ts
git commit -m "feat(cli): confirm project ref, refuse mismatched managed env"
```

---

### Task 4: Surface `--force` through the CLI entrypoint

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Parse `--force`**

Find the deploy branch (around line 41–51 per the exploration report). Update:

```typescript
case "deploy": {
  const code = await runDeploy({
    cwd: process.cwd(),
    dryRun: flags.has("--dry-run"),
    yes: flags.has("--yes") || flags.has("-y"),
    force: flags.has("--force"),
  });
  process.exit(code);
}
```

- [ ] **Step 2: Update the help text**

Find the help block (lines 16–18) and extend the deploy line:

```text
  --force         Allow deploy when the linked project differs from the
                  one recorded in supabase/.env
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): wire --force flag through deploy entrypoint"
```

---

### Task 5: Test — refuses deploy when project ref can't be resolved

**Files:**
- Create: `src/cli/commands/deploy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeploy } from "./deploy";
import type { SupabaseRunner } from "../supabase";

function setupCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "imp-cli-"));
  mkdirSync(join(dir, "supabase"), { recursive: true });
  writeFileSync(join(dir, "supabase", "config.toml"), "");
  return dir;
}

const okRunner = (responses: Record<string, { code: number; stdout?: string }>) =>
  (async (args: string[]) => {
    const key = args.join(" ");
    const r = responses[key];
    if (!r) throw new Error(`unexpected runner call: ${key}`);
    return { code: r.code, stdout: r.stdout ?? "", stderr: "" };
  }) as SupabaseRunner;

describe("runDeploy", () => {
  test("refuses when no project ref is resolvable", async () => {
    const cwd = setupCwd();
    const runner = okRunner({
      "--version": { code: 0 },
      "projects list": { code: 0 },
      "projects list --output json": { code: 0, stdout: "[]" },
    });

    const code = await runDeploy(
      { cwd, dryRun: false, yes: true, force: false },
      { runner },
    );
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Run test**

Run: `bun test src/cli/commands/deploy.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/deploy.test.ts
git commit -m "test(cli): refuse deploy with no resolvable project ref"
```

---

### Task 6: Test — refuses deploy when disk ref and CLI ref disagree

**Files:**
- Modify: `src/cli/commands/deploy.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("refuses when disk project ref differs from supabase CLI ref", async () => {
  const cwd = setupCwd();
  mkdirSync(join(cwd, "supabase", ".temp"), { recursive: true });
  writeFileSync(join(cwd, "supabase", ".temp", "project-ref"), "ref-disk");

  const runner = okRunner({
    "--version": { code: 0 },
    "projects list": { code: 0 },
    "projects list --output json": {
      code: 0,
      stdout: JSON.stringify([
        { id: "ref-cli", name: "CLI Project", linked: true },
      ]),
    },
  });

  const code = await runDeploy(
    { cwd, dryRun: false, yes: true, force: false },
    { runner },
  );
  expect(code).toBe(1);
});
```

- [ ] **Step 2: Run test**

Run: `bun test src/cli/commands/deploy.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/deploy.test.ts
git commit -m "test(cli): refuse deploy on disk/CLI project ref mismatch"
```

---

### Task 7: Test — refuses deploy when managed marker pins a different project (without `--force`)

**Files:**
- Modify: `src/cli/commands/deploy.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("refuses when managed env was stamped for a different project", async () => {
  const cwd = setupCwd();
  mkdirSync(join(cwd, "supabase", ".temp"), { recursive: true });
  writeFileSync(join(cwd, "supabase", ".temp", "project-ref"), "ref-current");
  writeFileSync(
    join(cwd, "supabase", ".env"),
    `# impersonate-sdk:project=ref-other\n# managed by impersonate-sdk\nIMPERSONATION_ADMIN_ROLES=admin\n`,
  );

  const runner = okRunner({
    "--version": { code: 0 },
    "projects list": { code: 0 },
    "projects list --output json": {
      code: 0,
      stdout: JSON.stringify([{ id: "ref-current", name: "Current", linked: true }]),
    },
  });

  const code = await runDeploy(
    { cwd, dryRun: false, yes: true, force: false },
    { runner },
  );
  expect(code).toBe(1);
});

test("--force allows deploy across managed-ref change", async () => {
  const cwd = setupCwd();
  mkdirSync(join(cwd, "supabase", ".temp"), { recursive: true });
  writeFileSync(join(cwd, "supabase", ".temp", "project-ref"), "ref-current");
  writeFileSync(
    join(cwd, "supabase", ".env"),
    `# impersonate-sdk:project=ref-other\nIMPERSONATION_ADMIN_ROLES=admin\n`,
  );

  const calls: string[] = [];
  const runner: SupabaseRunner = async (args) => {
    const key = args.join(" ");
    calls.push(key);
    if (key === "--version" || key === "projects list") return { code: 0, stdout: "", stderr: "" };
    if (key === "projects list --output json")
      return {
        code: 0,
        stdout: JSON.stringify([{ id: "ref-current", name: "Current", linked: true }]),
        stderr: "",
      };
    return { code: 0, stdout: "", stderr: "" };
  };

  const code = await runDeploy(
    { cwd, dryRun: false, yes: true, force: true },
    { runner },
  );
  expect(code).toBe(0);
  expect(calls).toContain("functions deploy impersonate-user");
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/cli/commands/deploy.test.ts`
Expected: PASS — 4 tests total.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/deploy.test.ts
git commit -m "test(cli): managed-ref guard refuses by default, allows under --force"
```

---

### Task 8: Test — partial failure does not stamp the managed marker

**Files:**
- Modify: `src/cli/commands/deploy.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("function deploy failure leaves managed marker unchanged", async () => {
  const cwd = setupCwd();
  mkdirSync(join(cwd, "supabase", ".temp"), { recursive: true });
  writeFileSync(join(cwd, "supabase", ".temp", "project-ref"), "ref-current");

  const runner: SupabaseRunner = async (args) => {
    const key = args.join(" ");
    if (key === "--version" || key === "projects list")
      return { code: 0, stdout: "", stderr: "" };
    if (key === "projects list --output json")
      return {
        code: 0,
        stdout: JSON.stringify([{ id: "ref-current", name: "Current", linked: true }]),
        stderr: "",
      };
    if (args[0] === "secrets") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "functions")
      return { code: 1, stdout: "", stderr: "deploy boom" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };

  const code = await runDeploy(
    { cwd, dryRun: false, yes: true, force: false },
    { runner },
  );
  expect(code).toBe(1);

  const { existsSync, readFileSync } = await import("node:fs");
  const envPath = join(cwd, "supabase", ".env");
  if (existsSync(envPath)) {
    expect(readFileSync(envPath, "utf8")).not.toContain("impersonate-sdk:project=");
  }
});
```

- [ ] **Step 2: Run test**

Run: `bun test src/cli/commands/deploy.test.ts`
Expected: PASS — 5 tests total.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/deploy.test.ts
git commit -m "test(cli): function deploy failure leaves managed marker untouched"
```

---

### Task 9: Test — rerun against the same project is a no-op confirmation flow

**Files:**
- Modify: `src/cli/commands/deploy.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("rerun against same project succeeds and refreshes marker", async () => {
  const cwd = setupCwd();
  mkdirSync(join(cwd, "supabase", ".temp"), { recursive: true });
  writeFileSync(join(cwd, "supabase", ".temp", "project-ref"), "ref-current");
  writeFileSync(
    join(cwd, "supabase", ".env"),
    `# impersonate-sdk:project=ref-current\nIMPERSONATION_ADMIN_ROLES=admin\n`,
  );

  const runner: SupabaseRunner = async (args) => {
    const key = args.join(" ");
    if (key === "--version" || key === "projects list")
      return { code: 0, stdout: "", stderr: "" };
    if (key === "projects list --output json")
      return {
        code: 0,
        stdout: JSON.stringify([{ id: "ref-current", name: "Current", linked: true }]),
        stderr: "",
      };
    return { code: 0, stdout: "", stderr: "" };
  };

  const code = await runDeploy(
    { cwd, dryRun: false, yes: true, force: false },
    { runner },
  );
  expect(code).toBe(0);

  const env = (await import("node:fs")).readFileSync(
    join(cwd, "supabase", ".env"),
    "utf8",
  );
  expect(env).toContain("impersonate-sdk:project=ref-current");
});
```

- [ ] **Step 2: Run all CLI tests**

Run: `bun test src/cli`
Expected: 6 tests passing.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/deploy.test.ts
git commit -m "test(cli): rerun against same project refreshes managed marker"
```

---

### Task 10: Document `--force` and the managed marker

**Files:**
- Modify: `README.md` (or `docs/cli.md` if present)

- [ ] **Step 1: Locate the deploy section**

Run: `grep -n "impersonate-sdk deploy\|## Deploy" README.md docs/ 2>/dev/null`

- [ ] **Step 2: Add the safeguards subsection**

```markdown
### Project-ref safeguards

`impersonate-sdk deploy` will:

1. Read the linked project ref from both `supabase/.temp/project-ref` (CLI v1)
   or `.supabase/project-ref` (CLI v2) **and** `supabase projects list --output json`,
   and refuse to deploy if the two disagree.
2. Print `target: <project name> (<ref>)` and require a typed `y` confirmation
   (skip with `--yes` / `-y`).
3. Stamp `supabase/.env` with `# impersonate-sdk:project=<ref>` after a
   successful deploy. On the next run, if the linked project ref differs from
   the stamped ref, the CLI aborts unless you pass `--force`.

`--force` is intended for legitimate project migrations — log it in your
infrastructure change log when you use it.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(cli): document project-ref safeguards and --force"
```

---

## Self-Review Notes

- **Spec coverage:** Codex asked for (a) explicit project ref confirmation, (b) detected metadata compared against `.env`/config, (c) idempotency, (d) fail-closed on ambiguity, (e) tests for multi-project workspaces, stale env, rerun, partial failure. Tasks 3–4 cover (a–d); Tasks 5–9 cover the test matrix.
- **Placeholder scan:** every code block has a real value or a real assertion; the only generic step is "locate the deploy section" in Task 10 which is a `grep`, not a placeholder.
- **Type consistency:** `SupabaseRunner` is the same signature in every consumer; `DeployDeps` always wraps `{ runner }`; the managed marker token `impersonate-sdk:project=<ref>` is identical in `envfile.ts`, in deploy.ts assertions, and in every test fixture.
- **Not in scope:** function-content hashing for true deploy idempotency. `supabase functions deploy` is already idempotent on the wire; adding a client-side hash buys little and would slip the scope of this plan. Documented as a follow-up if we later observe drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-cli-deploy-hardening.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — batch execution with checkpoints.
