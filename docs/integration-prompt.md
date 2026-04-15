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

### If Supabase

1. Copy the template: `cp -r node_modules/@sylergydigital/impersonate-sdk/servers/supabase/impersonate-user supabase/functions/impersonate-user`
2. Tell the user to set `IMPERSONATION_ADMIN_ROLES` in their Supabase dashboard (comma-separated, e.g. `admin` or `admin,superadmin`). Schema columns for role and display name are auto-detected from `profiles`; override with `IMPERSONATION_ROLE_TABLE` / `IMPERSONATION_ROLE_COLUMN` / `IMPERSONATION_NAME_TABLE` / `IMPERSONATION_NAME_COLUMN` only if auto-detect fails.
3. Deploy: `supabase functions deploy impersonate-user`

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

Find the root component (usually `App.tsx`, `_app.tsx`, or `layout.tsx`) and wrap it:

```tsx
import { ImpersonationProvider, ImpersonationBanner }
  from '@sylergydigital/impersonate-sdk/supabase-react';

<ImpersonationProvider
  manager={impersonationManager}
  onStart={(name) => /* navigate to user dashboard */}
  onStop={(reason) => /* navigate back to admin */}
>
  <ImpersonationBanner />
  {children}
</ImpersonationProvider>
```

Place `<ImpersonationBanner />` at the top of the layout so it renders as a sticky bar above all content.

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

The banner uses CSS custom properties. If the project has a theme token system (Tailwind, CSS variables, etc.), map them:

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
   - Clicking "Impersonate" requires the server endpoint to be deployed — if the project doesn't have it deployed yet, say so and give the user the exact deployment command for their stack

## Rules

- **Do not** hardcode admin checks on the client — the server endpoint must validate admin role
- **Do not** scaffold an admin UI, user list, or auth flow if it doesn't already exist — ask the user where to add the trigger button
- **Do not** commit secrets (Supabase service role keys, etc.) — these belong in the dashboard/env, not the repo
- **Do** preserve the project's existing code style (quotes, semicolons, import order)
- **Do** use the factory functions (`createSupabaseImpersonation`, `createGenericImpersonation`) over manual adapter + manager construction
- **Do** use `durationMinutes` over `durationMs` — it's clearer in configuration
- **Do** report what you found, what you changed, and what the user needs to do next (deploy the edge function, set env vars, etc.)

## Reference Docs

If you need more detail:

- [Getting Started](getting-started.md)
- [Adapters](adapters.md)
- [React API](react-api.md)
- [Configuration](configuration.md)
- [Security](security.md)
