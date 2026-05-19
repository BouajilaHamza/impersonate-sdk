# Server Auth Boundary Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Supabase `impersonate-user` edge function with explicit caller verification, optional cross-tenant target authorization, UUID validation, and negative tests for every refusal path.

**Architecture:** Split the Deno entrypoint from a pure handler factory so tests run under `bun:test`. Inject `createClient` and `env` into the factory. Add an optional `isAuthorizedForTarget(callerId, targetUserId, admin)` predicate so consumers can enforce tenant binding without coupling the SDK to a tenant model. Add a UUID format check before any admin lookup.

**Tech Stack:** TypeScript, Deno (runtime), `@supabase/supabase-js`, `bun:test` (unit), Supabase CLI (deploy).

---

## File Structure

- `servers/supabase/impersonate-user/handler.ts` — **new**: exports `createImpersonationHandler` + `isValidUuid`. Pure factory, no Deno globals.
- `servers/supabase/impersonate-user/index.ts` — **modified**: thin Deno entrypoint that reads `Deno.env`, builds the real `createClient`, and calls the factory.
- `servers/supabase/impersonate-user/handler.test.ts` — **new**: bun unit tests covering every refusal and success branch.
- `package.json` — **modified**: extend `"test"` glob to include the server handler tests.
- `src/types/server.ts` — **new (optional, used by index.ts)**: shared `HandlerOptions` / `HandlerDeps` types if we want to re-export them.

---

### Task 1: Split the Deno entrypoint from the handler factory

**Files:**
- Create: `servers/supabase/impersonate-user/handler.ts`
- Modify: `servers/supabase/impersonate-user/index.ts`

- [ ] **Step 1: Create the handler module**

Create `servers/supabase/impersonate-user/handler.ts` with the factory moved out, deps injectable. Use `any` for `createClient` return so tests can stub freely without dragging in the full supabase-js type surface.

```typescript
// servers/supabase/impersonate-user/handler.ts

type SupabaseLikeClient = any;
type CreateClientFn = (url: string, key: string, options?: any) => SupabaseLikeClient;

export interface HandlerEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export interface HandlerOptions {
  env: HandlerEnv;
  createClient: CreateClientFn;
  isAuthorized: (userId: string, admin: SupabaseLikeClient) => Promise<boolean>;
  isAuthorizedForTarget?: (
    callerId: string,
    targetUserId: string,
    admin: SupabaseLikeClient,
  ) => Promise<boolean>;
  getDisplayName?: (userId: string, admin: SupabaseLikeClient) => Promise<string | null>;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function createImpersonationHandler(options: HandlerOptions) {
  const { env, createClient, isAuthorized, isAuthorizedForTarget, getDisplayName } =
    options;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
      const supabaseUser = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });

      const {
        data: { user },
        error: authError,
      } = await supabaseUser.auth.getUser();

      if (authError || !user) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers: corsHeaders },
        );
      }

      const authorized = await isAuthorized(user.id, supabaseAdmin);
      if (!authorized) {
        return Response.json(
          { error: "Forbidden: insufficient permissions to impersonate" },
          { status: 403, headers: corsHeaders },
        );
      }

      let body: any;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400, headers: corsHeaders },
        );
      }
      const target_user_id = body?.target_user_id;

      if (!target_user_id) {
        return Response.json(
          { error: "Missing required field: target_user_id" },
          { status: 400, headers: corsHeaders },
        );
      }

      if (!isValidUuid(target_user_id)) {
        return Response.json(
          { error: "Invalid target_user_id format" },
          { status: 400, headers: corsHeaders },
        );
      }

      if (target_user_id === user.id) {
        return Response.json(
          { error: "Cannot impersonate yourself" },
          { status: 400, headers: corsHeaders },
        );
      }

      if (isAuthorizedForTarget) {
        const allowed = await isAuthorizedForTarget(
          user.id,
          target_user_id,
          supabaseAdmin,
        );
        if (!allowed) {
          return Response.json(
            { error: "Forbidden: caller not authorized for this target" },
            { status: 403, headers: corsHeaders },
          );
        }
      }

      const { data: targetAuthUser, error: targetAuthError } =
        await supabaseAdmin.auth.admin.getUserById(target_user_id);

      if (targetAuthError || !targetAuthUser?.user) {
        return Response.json(
          { error: "Target user not found" },
          { status: 404, headers: corsHeaders },
        );
      }

      const targetEmail = targetAuthUser.user.email;
      if (!targetEmail) {
        return Response.json(
          { error: "Target user has no email" },
          { status: 400, headers: corsHeaders },
        );
      }

      let targetUserName: string | null = null;
      if (getDisplayName) {
        targetUserName = await getDisplayName(target_user_id, supabaseAdmin);
      }

      const { data: linkData, error: linkError } =
        await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email: targetEmail,
        });

      if (linkError || !linkData?.properties?.hashed_token) {
        console.error("generateLink error:", linkError);
        return Response.json(
          { error: "Failed to generate impersonation token" },
          { status: 500, headers: corsHeaders },
        );
      }

      return Response.json(
        {
          hashed_token: linkData.properties.hashed_token,
          target_user_name: targetUserName || targetEmail,
        },
        { headers: corsHeaders },
      );
    } catch (err) {
      console.error("impersonate-user error:", err);
      return Response.json(
        { error: "Internal server error" },
        { status: 500, headers: corsHeaders },
      );
    }
  };
}
```

- [ ] **Step 2: Rewrite `index.ts` as a thin Deno entrypoint**

Replace `servers/supabase/impersonate-user/index.ts` with the Deno-only glue. Keep the schema auto-detection and `parseAdminRoles` exactly as before.

```typescript
// servers/supabase/impersonate-user/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createImpersonationHandler } from "./handler.ts";

type AdminClient = ReturnType<typeof createClient>;

const ROLE_COLUMN_CANDIDATES = ["role", "role_id", "user_role"] as const;
const NAME_COLUMN_CANDIDATES = ["display_name", "full_name", "name"] as const;

interface ResolvedSchema {
  roleTable: string;
  roleColumn: string;
  nameTable: string;
  nameColumn: string;
}

let schemaPromise: Promise<ResolvedSchema> | null = null;

async function columnExists(admin: AdminClient, table: string, column: string) {
  const { error } = await admin.from(table).select(column).limit(0);
  return !error;
}

async function probeColumn(
  admin: AdminClient,
  table: string,
  candidates: readonly string[],
  label: string,
) {
  for (const candidate of candidates) {
    if (await columnExists(admin, table, candidate)) return candidate;
  }
  throw new Error(
    `Could not auto-detect ${label} column on "${table}". ` +
      `Tried [${candidates.join(", ")}]. ` +
      `Set IMPERSONATION_${label.toUpperCase()}_COLUMN to override.`,
  );
}

async function resolveSchema(admin: AdminClient): Promise<ResolvedSchema> {
  const roleTable = Deno.env.get("IMPERSONATION_ROLE_TABLE") ?? "profiles";
  const nameTable = Deno.env.get("IMPERSONATION_NAME_TABLE") ?? "profiles";
  const roleColumnEnv = Deno.env.get("IMPERSONATION_ROLE_COLUMN");
  const nameColumnEnv = Deno.env.get("IMPERSONATION_NAME_COLUMN");

  const [roleColumn, nameColumn] = await Promise.all([
    roleColumnEnv
      ? Promise.resolve(roleColumnEnv)
      : probeColumn(admin, roleTable, ROLE_COLUMN_CANDIDATES, "role"),
    nameColumnEnv
      ? Promise.resolve(nameColumnEnv)
      : probeColumn(admin, nameTable, NAME_COLUMN_CANDIDATES, "name"),
  ]);

  return { roleTable, roleColumn, nameTable, nameColumn };
}

function getSchema(admin: AdminClient): Promise<ResolvedSchema> {
  if (!schemaPromise) {
    schemaPromise = resolveSchema(admin).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function parseAdminRoles(): string[] {
  const raw = Deno.env.get("IMPERSONATION_ADMIN_ROLES");
  if (!raw) {
    if (Deno.env.get("IMPERSONATION_ADMIN_ROLE_ID")) {
      throw new Error(
        "IMPERSONATION_ADMIN_ROLE_ID has been renamed to IMPERSONATION_ADMIN_ROLES " +
          'and now accepts a comma-separated list (e.g. "admin,superadmin").',
      );
    }
    throw new Error("IMPERSONATION_ADMIN_ROLES environment variable is required");
  }
  const roles = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (roles.length === 0) {
    throw new Error("IMPERSONATION_ADMIN_ROLES must contain at least one role");
  }
  return roles;
}

Deno.serve(
  createImpersonationHandler({
    env: {
      SUPABASE_URL: Deno.env.get("SUPABASE_URL")!,
      SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY")!,
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    },
    createClient,
    isAuthorized: async (userId, admin) => {
      const adminRoles = parseAdminRoles();
      const { roleTable, roleColumn } = await getSchema(admin);
      const { data } = await admin
        .from(roleTable)
        .select(roleColumn)
        .eq("id", userId)
        .single();
      return adminRoles.includes(data?.[roleColumn]);
    },
    getDisplayName: async (userId, admin) => {
      const { nameTable, nameColumn } = await getSchema(admin);
      const { data } = await admin
        .from(nameTable)
        .select(nameColumn)
        .eq("id", userId)
        .single();
      return data?.[nameColumn] ?? null;
    },
  }),
);
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `bun run typecheck`
Expected: exit 0 (no type errors).

- [ ] **Step 4: Commit**

```bash
git add servers/supabase/impersonate-user/handler.ts servers/supabase/impersonate-user/index.ts
git commit -m "refactor(server): split impersonate-user handler from Deno entrypoint"
```

---

### Task 2: Add bun test glob for the server handler

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Extend test script**

In `package.json`, change `"test"` from `"bun test src"` to:

```json
"test": "bun test src servers/supabase/impersonate-user"
```

- [ ] **Step 2: Verify bun still runs the existing src tests**

Run: `bun test src`
Expected: existing `src/core/ImpersonationManager.test.ts` passes.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(test): include server handler in bun test glob"
```

---

### Task 3: Test — unauthenticated caller returns 401

**Files:**
- Create: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// servers/supabase/impersonate-user/handler.test.ts
import { describe, test, expect } from "bun:test";
import { createImpersonationHandler } from "./handler";

const env = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

function makeClient(_url: string, _key: string, _opts?: any) {
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      admin: {
        getUserById: async () => ({ data: { user: null }, error: null }),
        generateLink: async () => ({ data: null, error: null }),
      },
    },
  };
}

describe("impersonate-user handler", () => {
  test("missing Authorization header returns 401", async () => {
    const handler = createImpersonationHandler({
      env,
      createClient: makeClient,
      isAuthorized: async () => true,
    });
    const res = await handler(new Request("http://x", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): unauthenticated caller returns 401"
```

---

### Task 4: Test — invalid JWT returns 401

**Files:**
- Modify: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside `describe`:

```typescript
test("invalid JWT returns 401", async () => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: { message: "bad jwt" } }),
      admin: { getUserById: async () => ({}), generateLink: async () => ({}) },
    },
  };
  const handler = createImpersonationHandler({
    env,
    createClient: () => client,
    isAuthorized: async () => true,
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { Authorization: "Bearer broken" },
  });
  const res = await handler(req);
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run test**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): invalid JWT returns 401"
```

---

### Task 5: Test — non-admin caller returns 403

**Files:**
- Modify: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("non-admin caller (isAuthorized=false) returns 403", async () => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "caller-1" } }, error: null }),
      admin: { getUserById: async () => ({}), generateLink: async () => ({}) },
    },
  };
  const handler = createImpersonationHandler({
    env,
    createClient: () => client,
    isAuthorized: async () => false,
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { Authorization: "Bearer ok" },
    body: JSON.stringify({ target_user_id: "11111111-1111-1111-1111-111111111111" }),
  });
  const res = await handler(req);
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run test**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): non-admin caller returns 403"
```

---

### Task 6: Test — malformed target_user_id returns 400

**Files:**
- Modify: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("malformed target_user_id (not a UUID) returns 400", async () => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "caller-1" } }, error: null }),
      admin: { getUserById: async () => ({}), generateLink: async () => ({}) },
    },
  };
  const handler = createImpersonationHandler({
    env,
    createClient: () => client,
    isAuthorized: async () => true,
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { Authorization: "Bearer ok" },
    body: JSON.stringify({ target_user_id: "not-a-uuid" }),
  });
  const res = await handler(req);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("Invalid target_user_id");
});
```

- [ ] **Step 2: Run test**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): malformed target_user_id returns 400"
```

---

### Task 7: Test — self-impersonation returns 400

**Files:**
- Modify: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("self-impersonation returns 400", async () => {
  const CALLER = "11111111-1111-1111-1111-111111111111";
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: CALLER } }, error: null }),
      admin: { getUserById: async () => ({}), generateLink: async () => ({}) },
    },
  };
  const handler = createImpersonationHandler({
    env,
    createClient: () => client,
    isAuthorized: async () => true,
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { Authorization: "Bearer ok" },
    body: JSON.stringify({ target_user_id: CALLER }),
  });
  const res = await handler(req);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("yourself");
});
```

- [ ] **Step 2: Run test**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): self-impersonation returns 400"
```

---

### Task 8: Test — `isAuthorizedForTarget` predicate rejects wrong-tenant target

**Files:**
- Modify: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("isAuthorizedForTarget=false returns 403 (tenant binding hook)", async () => {
  const CALLER = "11111111-1111-1111-1111-111111111111";
  const TARGET = "22222222-2222-2222-2222-222222222222";
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: CALLER } }, error: null }),
      admin: { getUserById: async () => ({}), generateLink: async () => ({}) },
    },
  };
  const calls: Array<[string, string]> = [];
  const handler = createImpersonationHandler({
    env,
    createClient: () => client,
    isAuthorized: async () => true,
    isAuthorizedForTarget: async (caller, target) => {
      calls.push([caller, target]);
      return false;
    },
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { Authorization: "Bearer ok" },
    body: JSON.stringify({ target_user_id: TARGET }),
  });
  const res = await handler(req);
  expect(res.status).toBe(403);
  expect(calls).toEqual([[CALLER, TARGET]]);
});
```

- [ ] **Step 2: Run test**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): isAuthorizedForTarget hook rejects wrong tenant"
```

---

### Task 9: Test — target user not found returns 404

**Files:**
- Modify: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("target user not found returns 404", async () => {
  const CALLER = "11111111-1111-1111-1111-111111111111";
  const TARGET = "22222222-2222-2222-2222-222222222222";
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: CALLER } }, error: null }),
      admin: {
        getUserById: async () => ({ data: { user: null }, error: null }),
        generateLink: async () => ({}),
      },
    },
  };
  const handler = createImpersonationHandler({
    env,
    createClient: () => client,
    isAuthorized: async () => true,
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { Authorization: "Bearer ok" },
    body: JSON.stringify({ target_user_id: TARGET }),
  });
  const res = await handler(req);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): target user not found returns 404"
```

---

### Task 10: Test — generateLink failure returns 500

**Files:**
- Modify: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("generateLink failure returns 500", async () => {
  const CALLER = "11111111-1111-1111-1111-111111111111";
  const TARGET = "22222222-2222-2222-2222-222222222222";
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: CALLER } }, error: null }),
      admin: {
        getUserById: async () => ({
          data: { user: { id: TARGET, email: "t@example.com" } },
          error: null,
        }),
        generateLink: async () => ({ data: null, error: { message: "boom" } }),
      },
    },
  };
  const handler = createImpersonationHandler({
    env,
    createClient: () => client,
    isAuthorized: async () => true,
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { Authorization: "Bearer ok" },
    body: JSON.stringify({ target_user_id: TARGET }),
  });
  const res = await handler(req);
  expect(res.status).toBe(500);
});
```

- [ ] **Step 2: Run test**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): generateLink failure returns 500"
```

---

### Task 11: Test — happy path returns hashed_token and display name

**Files:**
- Modify: `servers/supabase/impersonate-user/handler.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
test("happy path returns hashed_token and display name", async () => {
  const CALLER = "11111111-1111-1111-1111-111111111111";
  const TARGET = "22222222-2222-2222-2222-222222222222";
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: CALLER } }, error: null }),
      admin: {
        getUserById: async () => ({
          data: { user: { id: TARGET, email: "t@example.com" } },
          error: null,
        }),
        generateLink: async () => ({
          data: { properties: { hashed_token: "tok-xyz" } },
          error: null,
        }),
      },
    },
  };
  const handler = createImpersonationHandler({
    env,
    createClient: () => client,
    isAuthorized: async () => true,
    isAuthorizedForTarget: async () => true,
    getDisplayName: async () => "Target Display",
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { Authorization: "Bearer ok" },
    body: JSON.stringify({ target_user_id: TARGET }),
  });
  const res = await handler(req);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    hashed_token: "tok-xyz",
    target_user_name: "Target Display",
  });
});
```

- [ ] **Step 2: Run test**

Run: `bun test servers/supabase/impersonate-user/handler.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 3: Commit**

```bash
git add servers/supabase/impersonate-user/handler.test.ts
git commit -m "test(server): happy path returns hashed_token and display name"
```

---

### Task 12: Document the tenant-binding hook in the deploy guide

**Files:**
- Modify: `README.md` (or the existing deploy/server docs page if one exists — search `docs/` for the closest match)

- [ ] **Step 1: Locate the existing server-function deploy section**

Run: `grep -rn "impersonate-user" README.md docs/ 2>/dev/null | head -20`
Use the section that documents `IMPERSONATION_ADMIN_ROLES` env vars. If none exists, add a new section in `README.md` titled `### Cross-tenant binding`.

- [ ] **Step 2: Add the documentation block**

Insert under the env vars section:

```markdown
### Cross-tenant binding (multi-tenant projects)

If your Supabase project hosts multiple tenants, the default role check is not enough — any admin can impersonate any user. To restrict admins to their own tenant, fork `servers/supabase/impersonate-user/index.ts` and pass an `isAuthorizedForTarget` predicate when constructing the handler:

```typescript
createImpersonationHandler({
  // ...existing options
  isAuthorizedForTarget: async (callerId, targetUserId, admin) => {
    const [caller, target] = await Promise.all([
      admin.from("profiles").select("tenant_id").eq("id", callerId).single(),
      admin.from("profiles").select("tenant_id").eq("id", targetUserId).single(),
    ]);
    return caller.data?.tenant_id === target.data?.tenant_id;
  },
});
```

The predicate runs **after** the role check and **before** the target-user lookup. Returning `false` produces a 403.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(server): document isAuthorizedForTarget tenant-binding hook"
```

---

## Self-Review Notes

- **Spec coverage:** Negative tests for missing auth, invalid JWT, non-admin, malformed UUID, self-impersonation, target-not-found, generateLink failure, plus tenant-binding hook + happy path. All Codex findings under the server-function bullet are covered.
- **Placeholders:** none — every test contains the actual mock client.
- **Type consistency:** `createClient` injected as `CreateClientFn`; the same `SupabaseLikeClient = any` shape is used in every test stub, so `auth.getUser` / `auth.admin.getUserById` / `auth.admin.generateLink` signatures match across tasks.
- **Not in scope:** replayed-token detection. Supabase issues short-lived JWTs and validates them on `auth.getUser`; replay defense is the underlying Supabase concern, not this function. Documented as a non-goal here.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-server-auth-boundary.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — batch execution with checkpoints.
