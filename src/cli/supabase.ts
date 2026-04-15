import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runSupabase(
  args: string[],
  opts: { cwd: string; stream?: boolean } = { cwd: process.cwd() }
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("supabase", args, {
      cwd: opts.cwd,
      stdio: opts.stream ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    if (!opts.stream) {
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
    }

    child.on("error", () => {
      resolve({ code: 127, stdout, stderr: "supabase CLI not found on PATH" });
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function checkSupabaseInstalled(cwd: string): Promise<boolean> {
  const { code } = await runSupabase(["--version"], { cwd });
  return code === 0;
}

export async function checkLoggedIn(cwd: string): Promise<boolean> {
  const { code } = await runSupabase(["projects", "list"], { cwd });
  return code === 0;
}
