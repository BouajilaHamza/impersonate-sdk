import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock")))
    return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

export type Framework = "next" | "react-router" | "unknown";

export function detectFramework(cwd: string): Framework {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return "unknown";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return "next";
    if (deps["react-router"] || deps["react-router-dom"]) return "react-router";
  } catch {
    // fall through
  }
  return "unknown";
}

export function hasSupabaseProject(cwd: string): boolean {
  return existsSync(join(cwd, "supabase", "config.toml"));
}

export function isSupabaseLinked(cwd: string): boolean {
  return (
    existsSync(join(cwd, "supabase", ".temp", "project-ref")) ||
    existsSync(join(cwd, ".supabase", "project-ref"))
  );
}

export function getSupabaseProjectRef(cwd: string): string | null {
  for (const p of [
    join(cwd, "supabase", ".temp", "project-ref"),
    join(cwd, ".supabase", "project-ref"),
  ]) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf8").trim();
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export function detectRootLayoutCandidate(cwd: string): string | null {
  const candidates = [
    "app/layout.tsx",
    "app/layout.jsx",
    "src/app/layout.tsx",
    "src/main.tsx",
    "src/main.jsx",
    "src/App.tsx",
    "src/App.jsx",
    "src/root.tsx",
    "src/routes/root.tsx",
  ];
  for (const c of candidates) {
    if (existsSync(join(cwd, c))) return c;
  }
  return null;
}
