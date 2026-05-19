import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../loadConfig";
import { configToEnv } from "../envfile";
import {
  isSupabaseLinked,
  getSupabaseProjectRef,
  hasSupabaseProject,
} from "../detect";
import {
  checkSupabaseInstalled,
  checkLoggedIn,
  runSupabase,
} from "../supabase";
import { confirm, prompt } from "../prompts";
import {
  verifyAccess,
  pushSecrets as apiPushSecrets,
  deployFunction as apiDeployFunction,
} from "../managementApi";

const FUNCTION_NAME = "impersonate-user";
const EDGE_FN_REL = "supabase/functions/impersonate-user/index.ts";

interface DeployOpts {
  cwd: string;
  dryRun: boolean;
  yes: boolean;
  useCli: boolean;
}

interface Credentials {
  accessToken?: string;
  projectRef?: string;
  source: string;
}

export async function runDeploy(opts: DeployOpts): Promise<number> {
  const { cwd, dryRun, yes, useCli } = opts;

  process.stdout.write(`impersonate-sdk deploy${dryRun ? " (dry run)" : ""}\n\n`);

  if (!hasSupabaseProject(cwd)) {
    process.stderr.write("No supabase/config.toml found. Run `supabase init` first.\n");
    return 1;
  }

  const edgePath = join(cwd, EDGE_FN_REL);
  if (!existsSync(edgePath)) {
    process.stderr.write(
      `Edge function missing at ${EDGE_FN_REL}.\nRun \`npx impersonate-sdk init\` first.\n`
    );
    return 1;
  }

  const secrets = await resolveSecrets(cwd);
  if (secrets === null) return 1;

  const creds = resolveCredentials(cwd);
  const wantApi = !useCli && Boolean(creds.accessToken);

  if (wantApi) {
    return deployViaApi({ cwd, dryRun, yes }, secrets, creds);
  }

  if (useCli) {
    return deployViaCli({ cwd, dryRun, yes }, secrets);
  }

  // No PAT, no explicit --use-cli. Prefer CLI if installed+linked, else explain.
  const cliReady = (await checkSupabaseInstalled(cwd)) && (await checkLoggedIn(cwd)) && isSupabaseLinked(cwd);
  if (cliReady) {
    process.stdout.write("• mode:    supabase CLI (no SUPABASE_ACCESS_TOKEN set)\n");
    return deployViaCli({ cwd, dryRun, yes }, secrets);
  }

  process.stderr.write(
    "No deploy path available.\n\n" +
      "Pick one:\n" +
      "  (a) zero-CLI path — create PAT at https://supabase.com/dashboard/account/tokens\n" +
      "      then set in .env or supabase/.env:\n" +
      "        SUPABASE_ACCESS_TOKEN=sbp_...\n" +
      "        SUPABASE_PROJECT_REF=<your-ref>\n\n" +
      "  (b) supabase CLI path — install + login + link:\n" +
      "        supabase login\n" +
      "        supabase link --project-ref <your-ref>\n"
  );
  return 1;
}

async function resolveSecrets(cwd: string): Promise<Record<string, string> | null> {
  const loaded = await loadConfig(cwd);
  if (loaded) {
    process.stdout.write(`• config:  ${loaded.path}\n`);
    return configToEnv(loaded.config);
  }
  process.stdout.write("No impersonate.config.ts found.\n");
  const answer = await prompt(
    "Which role(s) can impersonate? (comma-separated, default: admin): ",
    "admin"
  );
  const roles = answer.split(",").map((s) => s.trim()).filter(Boolean);
  if (!roles.length) {
    process.stderr.write("At least one admin role required.\n");
    return null;
  }
  return { IMPERSONATION_ADMIN_ROLES: roles.join(",") };
}

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveCredentials(cwd: string): Credentials {
  const sources: Array<[string, Record<string, string>]> = [
    [".env", readDotEnv(join(cwd, ".env"))],
    [".env.local", readDotEnv(join(cwd, ".env.local"))],
    ["supabase/.env", readDotEnv(join(cwd, "supabase", ".env"))],
    ["process.env", process.env as Record<string, string>],
  ];

  let accessToken: string | undefined;
  let projectRef: string | undefined;
  let tokenSource = "(none)";

  for (const [name, env] of sources) {
    const tok = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PAT;
    if (tok && !accessToken) {
      accessToken = tok;
      tokenSource = name;
    }
    const ref = env.SUPABASE_PROJECT_REF;
    if (ref && !projectRef) projectRef = ref;
  }

  if (!projectRef) {
    const linked = getSupabaseProjectRef(cwd);
    if (linked) projectRef = linked;
  }

  return { accessToken, projectRef, source: tokenSource };
}

async function deployViaApi(
  opts: Omit<DeployOpts, "useCli">,
  secrets: Record<string, string>,
  creds: Credentials
): Promise<number> {
  const { cwd, dryRun, yes } = opts;
  const accessToken = creds.accessToken!;
  let projectRef = creds.projectRef;

  if (!projectRef) {
    projectRef = (
      await prompt("Supabase project ref (from dashboard URL): ", "")
    ).trim();
    if (!projectRef) {
      process.stderr.write("Project ref required.\n");
      return 1;
    }
  }

  process.stdout.write("• mode:    Management API (zero-CLI)\n");
  process.stdout.write(`• token:   ${creds.source}\n`);
  process.stdout.write(`• target:  project ${projectRef}\n\n`);

  process.stdout.write("Will call:\n");
  process.stdout.write(
    `  POST  /v1/projects/${projectRef}/secrets   (${Object.keys(secrets).join(", ")})\n`
  );
  process.stdout.write(
    `  POST  /v1/projects/${projectRef}/functions (slug: ${FUNCTION_NAME})\n\n`
  );

  if (dryRun) {
    process.stdout.write("(dry run — no changes made)\n");
    return 0;
  }

  if (!yes) {
    process.stdout.write(
      "Note: this overwrites existing production secrets with the same names.\n"
    );
    const ok = await confirm("Proceed?", false);
    if (!ok) {
      process.stdout.write("Aborted.\n");
      return 1;
    }
  }

  const apiOpts = { accessToken, projectRef };

  process.stdout.write("\n→ verifying access...\n");
  if (!(await verifyAccess(apiOpts))) {
    process.stderr.write(
      "Access token invalid, expired, or lacks access to this project.\n" +
        "Create a fresh PAT: https://supabase.com/dashboard/account/tokens\n"
    );
    return 1;
  }

  process.stdout.write("→ pushing secrets...\n");
  try {
    await apiPushSecrets(secrets, apiOpts);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }
  process.stdout.write("✓ secrets pushed\n");

  process.stdout.write("→ deploying function...\n");
  const source = readFileSync(join(cwd, EDGE_FN_REL), "utf8");
  try {
    await apiDeployFunction(FUNCTION_NAME, source, apiOpts);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }
  process.stdout.write("✓ function deployed\n\n");

  process.stdout.write("Smoke-test:\n");
  process.stdout.write(
    `  curl -X POST https://${projectRef}.supabase.co/functions/v1/${FUNCTION_NAME} \\\n` +
      `    -H "Authorization: Bearer <admin-access-token>" \\\n` +
      `    -H "Content-Type: application/json" \\\n` +
      `    -d '{"target_user_id":"<uuid>"}'\n`
  );
  return 0;
}

async function deployViaCli(
  opts: Omit<DeployOpts, "useCli">,
  secrets: Record<string, string>
): Promise<number> {
  const { cwd, dryRun, yes } = opts;

  if (!dryRun) {
    if (!(await checkSupabaseInstalled(cwd))) {
      process.stderr.write(
        "supabase CLI not found on PATH.\n" +
          "Install: https://supabase.com/docs/guides/cli/getting-started\n"
      );
      return 1;
    }
    if (!(await checkLoggedIn(cwd))) {
      process.stderr.write("Not logged in to Supabase. Run:\n  supabase login\n");
      return 1;
    }
    if (!isSupabaseLinked(cwd)) {
      process.stderr.write(
        "Project is not linked. Run:\n  supabase link --project-ref <your-project-ref>\n"
      );
      return 1;
    }
  }

  const projectRef = getSupabaseProjectRef(cwd);
  process.stdout.write(`• target:  ${projectRef ? `project ${projectRef}` : "linked project"}\n\n`);

  const secretArgs = Object.entries(secrets).map(([k, v]) => `${k}=${v}`);
  process.stdout.write("Will run:\n");
  process.stdout.write(`  supabase secrets set ${secretArgs.join(" ")}\n`);
  process.stdout.write(`  supabase functions deploy ${FUNCTION_NAME}\n\n`);

  if (dryRun) {
    process.stdout.write("(dry run — no changes made)\n");
    return 0;
  }

  if (!yes) {
    process.stdout.write(
      "Note: this overwrites existing production secrets with the same names.\n"
    );
    const ok = await confirm("Proceed?", false);
    if (!ok) {
      process.stdout.write("Aborted.\n");
      return 1;
    }
  }

  process.stdout.write("\n→ pushing secrets...\n");
  const secretsResult = await runSupabase(["secrets", "set", ...secretArgs], {
    cwd,
    stream: true,
  });
  if (secretsResult.code !== 0) {
    process.stderr.write("supabase secrets set failed\n");
    return secretsResult.code;
  }

  process.stdout.write("\n→ deploying function...\n");
  const deployResult = await runSupabase(["functions", "deploy", FUNCTION_NAME], {
    cwd,
    stream: true,
  });
  if (deployResult.code !== 0) {
    process.stderr.write("supabase functions deploy failed\n");
    return deployResult.code;
  }

  process.stdout.write("\n✓ deployed. Smoke-test with:\n");
  if (projectRef) {
    process.stdout.write(
      `  curl -X POST https://${projectRef}.supabase.co/functions/v1/${FUNCTION_NAME} \\\n` +
        `    -H "Authorization: Bearer <admin-access-token>" \\\n` +
        `    -H "Content-Type: application/json" \\\n` +
        `    -d '{"target_user_id":"<uuid>"}'\n`
    );
  }
  return 0;
}
