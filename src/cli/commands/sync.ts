import { join } from "node:path";
import { loadConfig } from "../loadConfig";
import { configToEnv, writeManagedEnv } from "../envfile";
import { hasSupabaseProject } from "../detect";

const ENV_REL = "supabase/.env";

export async function runSync(opts: { cwd: string }): Promise<number> {
  const { cwd } = opts;

  if (!hasSupabaseProject(cwd)) {
    process.stderr.write("No supabase/config.toml found.\n");
    return 1;
  }

  const loaded = await loadConfig(cwd);
  if (!loaded) {
    process.stderr.write(
      "No impersonate.config.ts found. Nothing to sync.\n" +
        "Create one at the project root or run `npx impersonate-sdk init`.\n"
    );
    return 1;
  }

  const env = configToEnv(loaded.config);
  writeManagedEnv(join(cwd, ENV_REL), env);
  process.stdout.write(`✓ synced ${loaded.path} → ${ENV_REL}\n`);
  return 0;
}
