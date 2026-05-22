# Integration Prompt

This is the prompt for AI coding agents (Claude Code, Cursor, Windsurf, etc.) to integrate `@sylergydigital/impersonate-sdk` into an existing project.

**Usage:** Tell your agent:

> Fetch https://github.com/sylergydigital/impersonate-sdk/blob/main/docs/integration-prompt.md and follow it to integrate the impersonation SDK into this project.

Or paste the prompt below directly.

---

Integrate `@sylergydigital/impersonate-sdk` into this project. This SDK gives admins the ability to "view as" any user with an auto-expiring session, a countdown banner, and page-refresh survival.

## Phase 1 — Discovery

Before writing code, detect the following by reading `package.json`, config files, and a few source files:

1. **Package manager**: bun, pnpm, yarn, or npm
2. **Auth backend**: Supabase (`@supabase/supabase-js`), Firebase, Django, Flask, Express with sessions, Clerk, NextAuth, or custom
3. **UI framework**: React, Next.js (app or pages router), Vue, Svelte, or vanilla
4. **Router**: react-router, Next.js routing, TanStack Router, or none
5. **Existing admin UI**: is there already an admin/users page? Where is it?
6. **Auth context/hook**: find the existing useAuth/useUser hook and sign-out function — we will need to guard against accidental sign-out during impersonation

Report what you found, then proceed.

## Phase 2 — Install

Install the SDK with the detected package manager:

- bun: `bun add @sylergydigital/impersonate-sdk`
- pnpm: `pnpm add @sylergydigital/impersonate-sdk`
- yarn: `yarn add @sylergydigital/impersonate-sdk`
- npm: `npm install @sylergydigital/impersonate-sdk`

## Phase 3 — Server Endpoint

The SDK needs a server endpoint that validates the admin and returns a session for the target user. The client never decides who can impersonate.

### If Supabase (recommended — use the SDK CLI)

The SDK ships a CLI that copies the edge function, writes `supabase/.env`, and deploys via the Supabase Management API (or the `supabase` CLI if a PAT is not available).

1. `npx impersonate-sdk init` — copies the edge function to `supabase/functions/impersonate-user/`, writes `supabase/.env` from prompts or an existing `impersonate.config.ts`, and prints the provider-wiring snippet for the detected framework.
2. If the project is not yet linked: `supabase link --project-ref <your-project-ref>` (skip if already linked, or use the zero-CLI path below).
3. `npx impersonate-sdk deploy` — pushes secrets and deploys the function.
   - Zero-CLI path: set `SUPABASE_ACCESS_TOKEN` (create a PAT at https://supabase.com/dashboard/account/tokens) and `SUPABASE_PROJECT_REF` in `.env`, `.env.local`, or `supabase/.env`. Deploy runs against the Management API — no `supabase` binary needed.
   - CLI path: requires `supabase login` + `supabase link` already done.

Required env: `IMPERSONATION_ADMIN_ROLES` (comma-separated role values, e.g. `admin` or `admin,superadmin`). The `init` command prompts for it. Schema columns for role and display name are auto-detected from `profiles`; override only if auto-detect fails:

- `IMPERSONATION_ROLE_TABLE` / `IMPERSONATION_ROLE_COLUMN`
- `IMPERSONATION_NAME_TABLE` / `IMPERSONATION_NAME_COLUMN`

### If Supabase (manual fallback)

If the project can't run the CLI (Deno-only runtime, offline, etc.):

1. `cp -r node_modules/@sylergydigital/impersonate-sdk/servers/supabase/impersonate-user supabase/functions/impersonate-user`
2. Set `IMPERSONATION_ADMIN_ROLES` (and any column overrides) in the Supabase dashboard under Edge Function secrets.
3. `supabase functions deploy impersonate-user`

### If Express

1. Copy `node_modules/@sylergydigital/impersonate-sdk/servers/express/impersonate.ts` into the project's server folder
2. Mount it on an admin-protected route (e.g. `/api/admin/impersonate`)
3. Adapt the admin-check middleware to match the project's existing admin check

### If Django/Flask/custom

Create a POST endpoint that:

1. Verifies the caller is an admin (use the project's existing admin check)
2. Looks up the target user by the `target_user_id` in the request body
3. Creates a session/token for the target user
4. Returns the response in a shape that the client's `signIn` callback can consume (session cookie, JWT, etc.)

### Optional: shared config file

For projects that want one source of truth between the CLI and the app:

```ts
// impersonate.config.ts (project root)
import { defineImpersonationConfig } from '@sylergydigital/impersonate-sdk/config';

export default defineImpersonationConfig({
  adminRoles: ['admin', 'superadmin'],
  routes: { adminPath: '/admin/users', userPath: '/' },
  // Optional schema overrides:
  // roleTable: 'profiles', roleColumn: 'role',
  // nameTable: 'profiles', nameColumn: 'full_name',
});
```

`npx impersonate-sdk init` and `deploy` pick this up automatically. Run `npx impersonate-sdk sync` after editing to rewrite `supabase/.env`. The Deno edge function cannot import this file directly — the CLI bridges it to secrets.

## Phase 4 — Client Integration

### Pick the right entry point

- Supabase + React → `@sylergydigital/impersonate-sdk/supabase-react`
- Generic backend + React → `@sylergydigital/impersonate-sdk/react` + `@sylergydigital/impersonate-sdk/adapters/generic`
- Vanilla JS → `@sylergydigital/impersonate-sdk/adapters/<name>`

### Create the manager

For Supabase:

```ts
import { createSupabaseImpersonation } from '@sylergydigital/impersonate-sdk/supabase-react';

export const impersonationManager = createSupabaseImpersonation({
  supabaseClient: supabase,
  durationMinutes: 15,
});
```

For a generic backend (cookie-based auth with smart defaults):

```ts
import { createGenericImpersonation } from '@sylergydigital/impersonate-sdk/adapters/generic';

export const impersonationManager = createGenericImpersonation({
  startUrl: '/api/admin/impersonate',
  signIn: async (data) => {
    // Establish the session client-side using whatever the server returned
    // e.g. for JWT: localStorage.setItem('token', data.token)
    // Then reload so the app picks up the new session
    location.reload();
  },
  durationMinutes: 15,
});
```

### Wrap the app

Find the root component (usually `App.tsx`, `_app.tsx`, or `layout.tsx`) and wrap it.

If the project uses react-router, Next.js, or TanStack Router, prefer the matching router-handoff hook so `onStart` / `onStop` navigate via the project's router instead of a hard reload:

```tsx
// react-router v6/v7
import { ImpersonationProvider, ImpersonationBanner }
  from '@sylergydigital/impersonate-sdk/supabase-react';
import { useReactRouterHandoff }
  from '@sylergydigital/impersonate-sdk/react/router/react-router';

function AppWithImpersonation({ children }) {
  const handoff = useReactRouterHandoff({ adminPath: '/admin/users', userPath: '/' });
  return (
    <ImpersonationProvider manager={impersonationManager} {...handoff}>
      <ImpersonationBanner />
      {children}
    </ImpersonationProvider>
  );
}
```

Swap the import for the matching stack:

- Next.js (app or pages router) → `@sylergydigital/impersonate-sdk/react/router/next` (`useNextHandoff`)
- TanStack Router → `@sylergydigital/impersonate-sdk/react/router/tanstack` (`useTanstackHandoff`)

If there is no router (e.g. SPA shell, vanilla React tree), pass `onStart` / `onStop` directly:

```tsx
<ImpersonationProvider
  manager={impersonationManager}
  onStart={(name) => /* show toast / navigate */}
  onStop={(reason) => /* navigate back to admin */}
>
  <ImpersonationBanner />
  {children}
</ImpersonationProvider>
```

Place `<ImpersonationBanner />` once inside the provider. JSX position does not matter — the banner renders `position: fixed` (default: bottom of viewport), is draggable to snap top/bottom, and persists the admin's last-chosen position per browser. If the app has a fixed footer or header that the banner would cover, pass a custom `style` or use the headless `render` prop.

### Add the trigger

Find the existing admin/users page and add an "Impersonate" button to each row:

```tsx
import { useImpersonation } from '@sylergydigital/impersonate-sdk/supabase-react';

function UserRow({ user }) {
  const { start, isTransitioning } = useImpersonation();
  return (
    <button disabled={isTransitioning} onClick={() => start(user.id)}>
      Impersonate
    </button>
  );
}
```

If there is no admin page yet, ask the user where they want it and stop — don't scaffold a whole admin UI unless asked.

### Guard the sign-out function

For Supabase, swap the existing sign-out for the SDK hook:

```ts
import { useGuardedSignOut } from '@sylergydigital/impersonate-sdk/supabase-react';

const signOut = useGuardedSignOut(supabase);
```

For non-Supabase backends, wrap manually:

```ts
const { isActive, stop } = useImpersonation();
const signOut = async () => {
  if (isActive) { await stop(); return; }
  await yourSignOut();
};
```

## Phase 5 — Theming (if the project has a design system)

The banner reads CSS custom properties (`--imp-banner-bg`, `--imp-banner-urgent-bg`, `--imp-banner-text`, etc.).

### Tailwind / shadcn projects

One CSS import maps the banner tokens to the project's existing theme variables (`--primary`, `--destructive`, …):

```css
/* Tailwind v4 */
@import "@sylergydigital/impersonate-sdk/tailwind-v4.css";

/* Tailwind v3 (HSL triplet tokens, e.g. shadcn) */
@import "@sylergydigital/impersonate-sdk/tailwind.css";
```

Override any individual `--imp-*` var in your own CSS to customize after the import.

### Other design systems

Map the tokens manually:

```css
:root {
  --imp-banner-bg: <project's warning/accent color>;
  --imp-banner-text: <project's on-accent color>;
  --imp-banner-urgent-bg: <project's danger color>;
  --imp-banner-urgent-text: <project's on-danger color>;
}
```

For full custom UI, use the headless `render` prop on `<ImpersonationBanner>`.

## Phase 6 — Verification

After wiring everything up:

1. Run the project: `<detected package manager> dev`
2. Run the typechecker if the project has one: `tsc --noEmit` or `<package manager> typecheck`
3. Confirm:
   - The app still builds without TypeScript errors
   - The admin page shows an "Impersonate" button on user rows
   - Clicking "Impersonate" requires the server endpoint to be deployed — if not yet deployed, instruct the user to run `npx impersonate-sdk deploy` (Supabase) or to deploy their own endpoint.

## Rules

- **Do not** hardcode admin checks on the client — the server endpoint must validate admin role
- **Do not** scaffold an admin UI, user list, or auth flow if it doesn't already exist — ask the user where to add the trigger button
- **Do not** commit secrets (Supabase service role keys, etc.) — these belong in the dashboard/env, not the repo
- **Do** preserve the project's existing code style (quotes, semicolons, import order)
- **Do** use the factory functions (`createSupabaseImpersonation`, `createGenericImpersonation`) over manual adapter + manager construction
- **Do** use `durationMinutes` over `durationMs` — it's clearer in configuration
- **Do** prefer `npx impersonate-sdk init` + `deploy` over hand-copying templates on Supabase projects
- **Do** wire the matching router-handoff hook (`useReactRouterHandoff`, `useNextHandoff`, `useTanstackHandoff`) instead of relying on `location.reload()` for navigation
- **Do** swap the existing sign-out for `useGuardedSignOut(supabase)` on Supabase projects so impersonation is stopped first instead of clearing the admin session
- **Do** report what you found, what you changed, and what the user needs to do next (run `deploy`, set env vars, etc.)

## Reference Docs

If you need more detail:

- [Getting Started](getting-started.md)
- [Adapters](adapters.md)
- [React API](react-api.md)
- [Configuration](configuration.md)
- [Security](security.md)
