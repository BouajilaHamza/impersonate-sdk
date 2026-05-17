# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-05-17

### Security

- **CORS lockdown:** Edge function CORS now validates `Origin` against `IMPERSONATION_ALLOWED_ORIGINS` env var (no more wildcard `*`)
- **Input validation:** `target_user_id` is validated as UUID before DB queries
- **Rate limiting (approximate):** In-memory per-admin throttle on edge function (10 req/hr default, configurable via env). The limit is per Deno isolate, so the effective ceiling under multi-isolate Deploy is ≤ N × `IMPERSONATION_RATE_LIMIT_MAX`. Use a DB-backed limit if you need a strict global cap.
- **Audit logging:** New `impersonation_audit_log` table; fire-and-forget INSERT on impersonation start (never blocks the request)
- **Encryption removed (reverted from in-PR draft):** A short-lived `sessionStorage` AES-GCM layer was prototyped and removed before merge. The key would have lived in a JS-readable cookie alongside the encrypted blob, providing no real defense against the same XSS that would read `sessionStorage`. SessionStorage origin isolation is the actual protection; encryption added complexity without a meaningful threat-model improvement.

### Bug Fixes

- **Timer race condition:** Fixed multiple "expired" events firing when async stop is slow
- **Supabase adapter cleanup:** Added `destroyImpersonatedSession` to properly sign out impersonated session before restoring admin
- **useGuardedSignOut errors:** Now catches and re-throws signOut errors instead of silent swallowing

### UX

- **Extend button visibility:** Now shows whenever extension is available, not just during urgent phase

### Improvements

- **Edge function perf:** Cached `parseAdminRoles` at module level (no re-parsing per request)
- **React DevTools:** Added `displayName` to `ImpersonationContext`
- **Build:** Added `clean: true` to all tsup entries

### Migration Guide

- Set `IMPERSONATION_ALLOWED_ORIGINS` env var in Supabase dashboard (**required**)
- Run the new migration: `supabase db push` or `supabase migration up`
- Optionally set `IMPERSONATION_RATE_LIMIT_MAX` and `IMPERSONATION_RATE_LIMIT_WINDOW_MS`

## [0.6.0] - 2025-05-10

_Initial public release._
