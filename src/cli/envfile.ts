import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ImpersonationConfig } from "../config/defineConfig";

const MANAGED_KEYS = [
  "IMPERSONATION_ADMIN_ROLES",
  "IMPERSONATION_ROLE_TABLE",
  "IMPERSONATION_ROLE_COLUMN",
  "IMPERSONATION_NAME_TABLE",
  "IMPERSONATION_NAME_COLUMN",
] as const;

const MANAGED_MARKER = "# Managed by impersonate-sdk";

export function configToEnv(config: ImpersonationConfig): Record<string, string> {
  const env: Record<string, string> = {
    IMPERSONATION_ADMIN_ROLES: config.adminRoles.join(","),
  };
  if (config.roleTable) env.IMPERSONATION_ROLE_TABLE = config.roleTable;
  if (config.roleColumn) env.IMPERSONATION_ROLE_COLUMN = config.roleColumn;
  if (config.nameTable) env.IMPERSONATION_NAME_TABLE = config.nameTable;
  if (config.nameColumn) env.IMPERSONATION_NAME_COLUMN = config.nameColumn;
  return env;
}

export function writeManagedEnv(envPath: string, updates: Record<string, string>): void {
  let existing = "";
  if (existsSync(envPath)) {
    existing = readFileSync(envPath, "utf8");
  } else {
    mkdirSync(dirname(envPath), { recursive: true });
  }

  const lines = existing.split("\n");
  const keptLines = lines.filter((line) => {
    if (line.trim() === MANAGED_MARKER) return false;
    const eq = line.indexOf("=");
    if (eq === -1) return true;
    const key = line.slice(0, eq).trim();
    return !MANAGED_KEYS.includes(key as (typeof MANAGED_KEYS)[number]);
  });

  while (keptLines.length && keptLines[keptLines.length - 1] === "") {
    keptLines.pop();
  }

  const managedBlock = Object.entries(updates).map(([k, v]) => `${k}=${v}`);
  const header = keptLines.length ? ["", MANAGED_MARKER] : [MANAGED_MARKER];
  const out = [...keptLines, ...header, ...managedBlock, ""].join("\n");

  writeFileSync(envPath, out);
}
