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

const FUNCTION_NAME = "impersonate-user";

export async function runDeploy(opts: {
  cwd: string;
  dryRun: boolean;
  yes: boolean;
}): Promise<number> {
  const { cwd, dryRun, yes } = opts;

  process.stdout.write(`impersonate-sdk deploy${dryRun ? " (dry run)" : ""}\n\n`);

  // Preflight
  if (!hasSupabaseProject(cwd)) {
    process.stderr.write("No supabase/config.toml found. Run `supabase init` first.\n");
    return 1;
  }

  if (!dryRun) {
    const installed = await checkSupabaseInstalled(cwd);
    if (!installed) {
      process.stderr.write(
        "supabase CLI not found on PATH.\n" +
          "Install: https://supabase.com/docs/guides/cli/getting-started\n"
      );
      return 1;
    }

    const loggedIn = await checkLoggedIn(cwd);
    if (!loggedIn) {
      process.stderr.write(
        "Not logged in to Supabase. Run:\n  supabase login\n"
      );
      return 1;
    }

    if (!isSupabaseLinked(cwd)) {
      process.stderr.write(
        "Project is not linked. Run:\n  supabase link --project-ref <your-project-ref>\n"
      );
      return 1;
    }
  }

  // Resolve config → env vars
  const loaded = await loadConfig(cwd);
  let env: Record<string, string>;

  if (loaded) {
    env = configToEnv(loaded.config);
    process.stdout.write(`• config: ${loaded.path}\n`);
  } else {
    process.stdout.write("No impersonate.config.ts found.\n");
    const answer = await prompt(
      "Which role(s) can impersonate? (comma-separated, default: admin): ",
      "admin"
    );
    const roles = answer
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    env = { IMPERSONATION_ADMIN_ROLES: roles.join(",") };
  }

  // Preview
  const projectRef = getSupabaseProjectRef(cwd);
  process.stdout.write(
    `• target:  ${projectRef ? `project ${projectRef}` : "linked project"}\n\n`
  );
  process.stdout.write("Will run:\n");
  const secretArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
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

  // Push secrets
  process.stdout.write("\n→ pushing secrets...\n");
  const secretsResult = await runSupabase(["secrets", "set", ...secretArgs], {
    cwd,
    stream: true,
  });
  if (secretsResult.code !== 0) {
    process.stderr.write("supabase secrets set failed\n");
    return secretsResult.code;
  }

  // Deploy function
  process.stdout.write("\n→ deploying function...\n");
  const deployResult = await runSupabase(
    ["functions", "deploy", FUNCTION_NAME],
    { cwd, stream: true }
  );
  if (deployResult.code !== 0) {
    process.stderr.write("supabase functions deploy failed\n");
    return deployResult.code;
  }

  process.stdout.write("\n✓ deployed. Smoke-test with:\n");
  if (projectRef) {
    process.stdout.write(
      `  curl -X POST https://${projectRef}.supabase.co/functions/v1/${FUNCTION_NAME} \\\n` +
        `    -H "Authorization: Bearer <your-admin-access-token>" \\\n` +
        `    -H "Content-Type: application/json" \\\n` +
        `    -d '{"target_user_id":"<uuid>"}'\n`
    );
  }

  return 0;
}
