/**
 * Shared configuration for the impersonation SDK — the single source of
 * truth consumed by both the client app and the `impersonate-sdk` CLI.
 *
 * Place this file at your project root as `impersonate.config.ts` and
 * pass it to `defineImpersonationConfig(...)` for type safety.
 *
 * @example
 * ```ts
 * // impersonate.config.ts
 * import { defineImpersonationConfig } from '@sylergydigital/impersonate-sdk/config';
 *
 * export default defineImpersonationConfig({
 *   adminRoles: ['admin', 'superadmin'],
 *   routes: { adminPath: '/admin/users', userPath: '/' },
 * });
 * ```
 *
 * Note: the Deno edge function cannot import this file directly.
 * `npx impersonate-sdk deploy` bridges the config to Supabase secrets.
 */
export interface ImpersonationConfig {
  /** Role values allowed to call the impersonation endpoint. */
  adminRoles: string[];

  /** Optional schema overrides (default: auto-detected from `profiles`). */
  roleTable?: string;
  roleColumn?: string;
  nameTable?: string;
  nameColumn?: string;

  /** Default navigation targets used by the router handoff hooks. */
  routes?: {
    adminPath: string;
    userPath: string;
  };

  /** Session duration in milliseconds. Defaults to 15 minutes. */
  sessionDurationMs?: number;
}

export function defineImpersonationConfig(
  config: ImpersonationConfig
): ImpersonationConfig {
  return config;
}
