import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ImpersonationConfig } from "../config/defineConfig";

const CONFIG_CANDIDATES = [
  "impersonate.config.ts",
  "impersonate.config.mts",
  "impersonate.config.mjs",
  "impersonate.config.js",
];

export function findConfigPath(cwd: string): string | null {
  for (const name of CONFIG_CANDIDATES) {
    const full = join(cwd, name);
    if (existsSync(full)) return full;
  }
  return null;
}

export async function loadConfig(
  cwd: string
): Promise<{ config: ImpersonationConfig; path: string } | null> {
  const path = findConfigPath(cwd);
  if (!path) return null;

  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const mod: unknown = await jiti.import(path);
  const config = (mod as { default?: ImpersonationConfig }).default ?? mod;

  if (
    !config ||
    typeof config !== "object" ||
    !Array.isArray((config as ImpersonationConfig).adminRoles)
  ) {
    throw new Error(
      `Invalid config at ${path}: expected a defineImpersonationConfig({...}) export with adminRoles: string[]`
    );
  }

  return { config: config as ImpersonationConfig, path };
}
