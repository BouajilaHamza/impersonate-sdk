import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves to the edge-function source shipped inside this package.
 * When running from dist/cli/index.js, `here` is `dist/cli/` so we walk
 * up two levels to the package root, then into `servers/...`.
 */
export function edgeFunctionTemplatePath(): string {
  return resolve(here, "..", "..", "servers", "supabase", "impersonate-user", "index.ts");
}

export function readEdgeFunctionTemplate(): string {
  return readFileSync(edgeFunctionTemplatePath(), "utf8");
}
