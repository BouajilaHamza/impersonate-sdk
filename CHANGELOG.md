# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2025-05-17

### Security

- **CORS lockdown:** Edge function CORS now validates `Origin` against `IMPERSONATION_ALLOWED_ORIGINS` env var (no more wildcard `*`)
- **Session encryption:** Admin session snapshots are encrypted with AES-GCM before storage in `sessionStorage`
- **Input validation:** `target_user_id` is validated as UUID before DB queries
- **Rate limiting:** In-memory rate limiting on edge function (10 req/hr per admin, configurable via env)
- **Audit logging:** New `impersonation_audit_log` table + automatic INSERT on impersonation start

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
