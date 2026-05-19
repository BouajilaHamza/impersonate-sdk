import { runInit } from "./commands/init";
import { runDeploy } from "./commands/deploy";
import { runSync } from "./commands/sync";

const HELP = `impersonate-sdk — zero-config integration for @sylergydigital/impersonate-sdk

Usage:
  npx impersonate-sdk <command> [options]

Commands:
  init     Copy the edge function, write supabase/.env, print provider wiring.
  deploy   Push secrets and deploy the edge function.
  sync     Re-read impersonate.config.ts and rewrite supabase/.env. No network.

Options:
  --dry-run    (deploy) print actions without running them
  --yes, -y    (deploy) skip the confirmation prompt
  --use-cli    (deploy) force supabase CLI path instead of Management API
  --help, -h   show this message

Deploy paths:
  Default uses Supabase Management API — no CLI binary required.
  Set in .env, .env.local, or supabase/.env:
    SUPABASE_ACCESS_TOKEN=sbp_...   (create at supabase.com/dashboard/account/tokens)
    SUPABASE_PROJECT_REF=<your-ref>
  Falls back to the supabase CLI if installed, logged in, and linked.

Examples:
  npx impersonate-sdk init
  npx impersonate-sdk deploy --dry-run
  npx impersonate-sdk deploy --yes
  npx impersonate-sdk deploy --use-cli
`;

function printHelp(): void {
  process.stdout.write(HELP);
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return 0;
  }

  const flags = new Set(rest);
  const cwd = process.cwd();

  switch (cmd) {
    case "init":
      return runInit({ cwd });
    case "deploy":
      return runDeploy({
        cwd,
        dryRun: flags.has("--dry-run"),
        yes: flags.has("--yes") || flags.has("-y"),
        useCli: flags.has("--use-cli"),
      });
    case "sync":
      return runSync({ cwd });
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n`);
      printHelp();
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${msg}\n`);
    process.exit(1);
  }
);
