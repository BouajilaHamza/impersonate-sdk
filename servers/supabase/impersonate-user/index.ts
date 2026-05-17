/**
 * Supabase Edge Function: impersonate-user
 *
 * Generates a magic link token for admin impersonation.
 * The client uses this token with verifyOtp() to establish the target user's session.
 *
 * Required environment variables:
 *   SUPABASE_URL                 - Set automatically by Supabase
 *   SUPABASE_ANON_KEY            - Set automatically by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    - Set automatically by Supabase
 *   IMPERSONATION_ADMIN_ROLES    - Comma-separated role values allowed to impersonate
 *                                  (e.g. "admin" or "admin,superadmin")
 *
 * Optional environment variables (override auto-detected schema):
 *   IMPERSONATION_ROLE_TABLE  - Table to query for role (default: "profiles")
 *   IMPERSONATION_ROLE_COLUMN - Column containing role value; auto-detected from
 *                               ["role","role_id","user_role"] if unset
 *   IMPERSONATION_NAME_TABLE  - Table to query for display name (default: "profiles")
 *   IMPERSONATION_NAME_COLUMN - Column for display name; auto-detected from
 *                               ["display_name","full_name","name"] if unset
 *
 * Deploy: supabase functions deploy impersonate-user
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Rate limiting (in-memory, per Deno isolate) ────────────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS =
  parseInt(Deno.env.get("IMPERSONATION_RATE_LIMIT_WINDOW_MS") ?? "", 10) ||
  60 * 60 * 1000; // 1 hour default
const RATE_LIMIT_MAX =
  parseInt(Deno.env.get("IMPERSONATION_RATE_LIMIT_MAX") ?? "", 10) || 10; // 10 requests per window default

function checkRateLimit(adminId: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(adminId);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(adminId, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  entry.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

function getCorsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };

  const allowedOrigins = (Deno.env.get("IMPERSONATION_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = req.headers.get("Origin") ?? "";
  if (allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

// ── Factory: use this for advanced customization ───────────────────

interface HandlerOptions {
  /** Return true if the user is authorized to impersonate others. */
  isAuthorized: (
    userId: string,
    supabaseAdmin: ReturnType<typeof createClient>
  ) => Promise<boolean>;

  /** Return a display name for the target user. */
  getDisplayName?: (
    userId: string,
    supabaseAdmin: ReturnType<typeof createClient>
  ) => Promise<string | null>;
}

export function createImpersonationHandler(options: HandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: getCorsHeaders(req) });
    }

    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers: getCorsHeaders(req) }
        );
      }

      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      // Verify the caller
      const {
        data: { user },
        error: authError,
      } = await supabaseUser.auth.getUser();

      if (authError || !user) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers: getCorsHeaders(req) }
        );
      }

      // Check authorization
      const authorized = await options.isAuthorized(user.id, supabaseAdmin);
      if (!authorized) {
        return Response.json(
          { error: "Forbidden: insufficient permissions to impersonate" },
          { status: 403, headers: getCorsHeaders(req) }
        );
      }

      // Rate limit check
      const rateLimit = checkRateLimit(user.id);
      if (!rateLimit.allowed) {
        return Response.json(
          { error: "Rate limit exceeded. Try again later." },
          {
            status: 429,
            headers: {
              ...getCorsHeaders(req),
              "Retry-After": String(rateLimit.retryAfterSeconds),
            },
          }
        );
      }

      const { target_user_id } = await req.json();

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!target_user_id || typeof target_user_id !== 'string' || !UUID_RE.test(target_user_id)) {
        return Response.json(
          { error: "Invalid target_user_id: must be a valid UUID" },
          { status: 400, headers: getCorsHeaders(req) }
        );
      }

      // Prevent self-impersonation
      if (target_user_id === user.id) {
        return Response.json(
          { error: "Cannot impersonate yourself" },
          { status: 400, headers: getCorsHeaders(req) }
        );
      }

      // Get target user's email from auth
      const { data: targetAuthUser, error: targetAuthError } =
        await supabaseAdmin.auth.admin.getUserById(target_user_id);

      if (targetAuthError || !targetAuthUser?.user) {
        return Response.json(
          { error: "Target user not found" },
          { status: 404, headers: getCorsHeaders(req) }
        );
      }

      const targetEmail = targetAuthUser.user.email;
      if (!targetEmail) {
        return Response.json(
          { error: "Target user has no email" },
          { status: 400, headers: getCorsHeaders(req) }
        );
      }

      // Get display name
      let targetUserName: string | null = null;
      if (options.getDisplayName) {
        targetUserName = await options.getDisplayName(
          target_user_id,
          supabaseAdmin
        );
      }

      // Generate magic link (no email sent)
      const { data: linkData, error: linkError } =
        await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email: targetEmail,
        });

      if (linkError || !linkData?.properties?.hashed_token) {
        console.error("generateLink error:", linkError);
        return Response.json(
          { error: "Failed to generate impersonation token" },
          { status: 500, headers: getCorsHeaders(req) }
        );
      }

      // Audit log (best-effort, don't await if you want fire-and-forget)
      await logImpersonation(supabaseAdmin, user.id, target_user_id, targetUserName);

      return Response.json(
        {
          hashed_token: linkData.properties.hashed_token,
          target_user_name: targetUserName || targetEmail,
        },
        { headers: getCorsHeaders(req) }
      );
    } catch (err) {
      console.error("impersonate-user error:", err);
      return Response.json(
        { error: "Internal server error" },
        { status: 500, headers: getCorsHeaders(req) }
      );
    }
  };
}

// ── Default handler using environment variables ────────────────────

const ROLE_COLUMN_CANDIDATES = ["role", "role_id", "user_role"] as const;
const NAME_COLUMN_CANDIDATES = ["display_name", "full_name", "name"] as const;

type AdminClient = ReturnType<typeof createClient>;

interface ResolvedSchema {
  roleTable: string;
  roleColumn: string;
  nameTable: string;
  nameColumn: string;
}

let schemaPromise: Promise<ResolvedSchema> | null = null;

async function columnExists(
  admin: AdminClient,
  table: string,
  column: string
): Promise<boolean> {
  const { error } = await admin.from(table).select(column).limit(0);
  return !error;
}

async function probeColumn(
  admin: AdminClient,
  table: string,
  candidates: readonly string[],
  label: string
): Promise<string> {
  for (const candidate of candidates) {
    if (await columnExists(admin, table, candidate)) return candidate;
  }
  throw new Error(
    `Could not auto-detect ${label} column on "${table}". ` +
      `Tried [${candidates.join(", ")}]. ` +
      `Set IMPERSONATION_${label.toUpperCase()}_COLUMN to override.`
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

let cachedAdminRoles: string[] | null = null;

function parseAdminRoles(): string[] {
  if (cachedAdminRoles !== null) return cachedAdminRoles;

  const raw = Deno.env.get("IMPERSONATION_ADMIN_ROLES");
  if (!raw) {
    if (Deno.env.get("IMPERSONATION_ADMIN_ROLE_ID")) {
      throw new Error(
        "IMPERSONATION_ADMIN_ROLE_ID has been renamed to IMPERSONATION_ADMIN_ROLES " +
          'and now accepts a comma-separated list (e.g. "admin,superadmin").'
      );
    }
    throw new Error(
      "IMPERSONATION_ADMIN_ROLES environment variable is required"
    );
  }
  const roles = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (roles.length === 0) {
    throw new Error("IMPERSONATION_ADMIN_ROLES must contain at least one role");
  }
  cachedAdminRoles = roles;
  return roles;
}

// ── Audit logging ────────────────────────────────────────────────
async function logImpersonation(
  admin: AdminClient,
  adminId: string,
  targetId: string,
  targetDisplayName: string | null
): Promise<void> {
  try {
    await admin.from("impersonation_audit_log").insert({
      admin_id: adminId,
      target_user_id: targetId,
      target_display_name: targetDisplayName,
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    // Audit logging is best-effort — don't fail the request
    console.error("[impersonate-sdk] audit log failed:", err);
  }
}

Deno.serve(
  createImpersonationHandler({
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
  })
);
