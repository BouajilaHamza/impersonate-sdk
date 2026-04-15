import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  detectPackageManager,
  detectFramework,
  detectRootLayoutCandidate,
  hasSupabaseProject,
  isSupabaseLinked,
} from "../detect";
import { loadConfig } from "../loadConfig";
import { readEdgeFunctionTemplate } from "../templates";
import { configToEnv, writeManagedEnv } from "../envfile";
import { prompt } from "../prompts";

const EDGE_FN_REL = "supabase/functions/impersonate-user/index.ts";
const ENV_REL = "supabase/.env";

function providerSnippet(framework: string): string {
  const importPath =
    framework === "next"
      ? "@sylergydigital/impersonate-sdk/react/router/next"
      : "@sylergydigital/impersonate-sdk/react/router/react-router";
  const hookName = framework === "next" ? "useNextHandoff" : "useReactRouterHandoff";

  return `import { createSupabaseImpersonation, ImpersonationProvider, ImpersonationBanner }
  from '@sylergydigital/impersonate-sdk/supabase-react';
import { ${hookName} } from '${importPath}';

const manager = createSupabaseImpersonation({ supabaseClient: supabase, durationMinutes: 15 });

export function AppWithImpersonation({ children }) {
  const handoff = ${hookName}({ adminPath: '/admin/users', userPath: '/' });
  return (
    <ImpersonationProvider manager={manager} {...handoff}>
      <ImpersonationBanner />
      {children}
    </ImpersonationProvider>
  );
}`;
}

export async function runInit(opts: { cwd: string }): Promise<number> {
  const { cwd } = opts;

  process.stdout.write("impersonate-sdk init\n\n");

  // Detect environment
  const pm = detectPackageManager(cwd);
  const framework = detectFramework(cwd);
  const hasSupabase = hasSupabaseProject(cwd);
  const linked = isSupabaseLinked(cwd);

  process.stdout.write(`  package manager: ${pm}\n`);
  process.stdout.write(`  framework:       ${framework}\n`);
  process.stdout.write(`  supabase:        ${hasSupabase ? "detected" : "not found"}\n`);
  process.stdout.write(`  linked:          ${linked ? "yes" : "no"}\n\n`);

  if (!hasSupabase) {
    process.stderr.write(
      "No supabase/config.toml found. Run `supabase init` first, then re-run this command.\n"
    );
    return 1;
  }

  // Copy edge function template
  const edgeDest = join(cwd, EDGE_FN_REL);
  if (existsSync(edgeDest)) {
    process.stdout.write(`• edge function already exists at ${EDGE_FN_REL}, skipping copy\n`);
  } else {
    mkdirSync(dirname(edgeDest), { recursive: true });
    writeFileSync(edgeDest, readEdgeFunctionTemplate());
    process.stdout.write(`• copied edge function → ${EDGE_FN_REL}\n`);
  }

  // Load or prompt for admin roles
  const loaded = await loadConfig(cwd);
  let env: Record<string, string>;

  if (loaded) {
    env = configToEnv(loaded.config);
    process.stdout.write(`• loaded config from ${loaded.path}\n`);
  } else {
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

  const envPath = join(cwd, ENV_REL);
  writeManagedEnv(envPath, env);
  process.stdout.write(`• wrote env → ${ENV_REL}\n`);

  // Print provider wiring (don't auto-modify — too risky to parse entry files)
  const layout = detectRootLayoutCandidate(cwd);
  process.stdout.write("\nNext: wire the provider into your app root");
  if (layout) process.stdout.write(` (looks like ${layout})`);
  process.stdout.write(":\n\n");
  for (const line of providerSnippet(framework).split("\n")) {
    process.stdout.write(`    ${line}\n`);
  }

  process.stdout.write("\nThen deploy to production:\n");
  if (!linked) {
    process.stdout.write("  supabase login\n");
    process.stdout.write("  supabase link --project-ref <your-project-ref>\n");
  }
  process.stdout.write("  npx impersonate-sdk deploy\n\n");

  return 0;
}
