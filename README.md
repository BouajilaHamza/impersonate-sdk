# @sylergydigital/impersonate-sdk

Universal admin impersonation for any web app. Let admins "view as" any user with a single SDK.

Auth-agnostic core with adapters for **Supabase**, **Firebase**, **Django**, **Flask**, **Express**, and any REST backend.

## Features

- **Auth-agnostic** -- adapter pattern works with any auth backend
- **Auto-expiry timer** -- 15-minute default with configurable hard cap
- **Built-in banner** -- movable notification bar with countdown, extend, and end actions
- **Page-refresh survival** -- timer, session, and display name persist through refreshes
- **Cross-tab safety** -- detects orphaned impersonation sessions
- **Headless mode** -- use the hook for fully custom UI
- **Tree-shakeable** -- separate entry points for core, React, and each adapter
- **Zero dependencies** -- core is pure TypeScript

## Quick Start (Supabase + React)

```bash
bun add @sylergydigital/impersonate-sdk
npx impersonate-sdk init                  # copy edge function, write supabase/.env
supabase link --project-ref <your-ref>    # if not already linked
npx impersonate-sdk deploy                # push secrets + deploy the function
```

Then wire the provider into your app root (the `init` command prints the
exact snippet for your router):

```tsx
import {
  createSupabaseImpersonation,
  ImpersonationProvider,
  ImpersonationBanner,
  useImpersonation,
} from '@sylergydigital/impersonate-sdk/supabase-react';

const manager = createSupabaseImpersonation({
  supabaseClient: supabase,
  durationMinutes: 15,
});

function App() {
  return (
    <ImpersonationProvider manager={manager}>
      <ImpersonationBanner />
      <YourApp />
    </ImpersonationProvider>
  );
}

// Then from any component:
function UserRow({ user }) {
  const { start } = useImpersonation();
  return <button onClick={() => start(user.id)}>Impersonate</button>;
}
```

That's it -- one import path, one factory call.

## Configuration file (optional)

Create `impersonate.config.ts` at the project root to share config between
the CLI (which writes `supabase/.env` and pushes secrets) and your app:

```ts
import { defineImpersonationConfig } from '@sylergydigital/impersonate-sdk/config';

export default defineImpersonationConfig({
  adminRoles: ['admin', 'superadmin'],
  routes: { adminPath: '/admin/users', userPath: '/' },
});
```

Run `npx impersonate-sdk sync` after editing to rewrite `supabase/.env`.

## Router handoff

For react-router, Next.js App Router, or TanStack Router, import the matching hook and spread it into the provider:

```tsx
// react-router v6+/v7
import { useReactRouterHandoff } from '@sylergydigital/impersonate-sdk/react/router/react-router';

const handoff = useReactRouterHandoff({ adminPath: '/admin/users', userPath: '/' });
<ImpersonationProvider manager={manager} {...handoff}>{children}</ImpersonationProvider>
```

Other routers: `@sylergydigital/impersonate-sdk/react/router/next` (`useNextHandoff`) and `@sylergydigital/impersonate-sdk/react/router/tanstack` (`useTanstackHandoff`). Same API, different peer dep.

## Tailwind theming

The banner reads CSS custom properties (`--imp-banner-bg`, `--imp-banner-urgent-bg`, etc.). For shadcn projects, one import maps them to `--primary` / `--destructive`:

```css
/* Tailwind v4 */
@import "@sylergydigital/impersonate-sdk/tailwind-v4.css";

/* Tailwind v3 (HSL triplet tokens) */
@import "@sylergydigital/impersonate-sdk/tailwind.css";
```

Override any individual `--imp-*` var in your own CSS to customize.

## Install with AI

Let Claude Code, Cursor, or any AI coding agent integrate the SDK for you. Copy the prompt below into your agent:

<details>
<summary><strong>Integration Prompt (click to expand)</strong></summary>

````markdown
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

Place `<ImpersonationBanner />` once in the layout. The default banner is fixed
to the bottom of the browser, can be dragged to snap between bottom and top, and
persists the admin's last chosen position in the browser.

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

Find the existing sign-out function and swap it for the SDK hook so impersonation is stopped first (which restores the admin session instead of signing them out):

```ts
import { useGuardedSignOut } from '@sylergydigital/impersonate-sdk/supabase-react';

const signOut = useGuardedSignOut(supabase);
// <button onClick={signOut}>Sign out</button>
```

For non-Supabase backends, keep the manual pattern:

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
- Getting Started: https://github.com/sylergydigital/impersonate-sdk/blob/main/docs/getting-started.md
- Adapters: https://github.com/sylergydigital/impersonate-sdk/blob/main/docs/adapters.md
- React API: https://github.com/sylergydigital/impersonate-sdk/blob/main/docs/react-api.md
- Configuration: https://github.com/sylergydigital/impersonate-sdk/blob/main/docs/configuration.md
- Security: https://github.com/sylergydigital/impersonate-sdk/blob/main/docs/security.md
````

</details>

Or give your agent this one-liner, which works with Claude Code, Cursor, and most agents that can fetch URLs:

> Fetch https://github.com/sylergydigital/impersonate-sdk/blob/main/docs/integration-prompt.md and follow it to integrate the impersonation SDK into this project.

## Documentation

| Guide | Description |
| --- | --- |
| [Getting Started](docs/getting-started.md) | Full setup walkthrough with server deployment |
| [Adapters](docs/adapters.md) | Supabase, Generic HTTP, and custom adapter guides |
| [React API](docs/react-api.md) | Provider, hook, banner, theming, and headless mode |
| [Vanilla JS](docs/vanilla-js.md) | Using the core without React |
| [Configuration](docs/configuration.md) | All options with defaults |
| [Security](docs/security.md) | Security model and best practices |
| [Integration Prompt](docs/integration-prompt.md) | Prompt for AI agents to integrate the SDK into a project |

## Roadmap

| Version | Scope |
| --- | --- |
| **0.1** | Core + Supabase adapter + Generic HTTP adapter + React bindings |
| 0.2 | Firebase adapter + Cloud Function template |
| 0.3 | Vue composable + Svelte store bindings |
| 0.4 | Django/Flask server templates |
| 1.0 | Audit trail, rate limiting, docs site |

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE)
