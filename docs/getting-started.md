# Getting Started

This guide walks through the full setup for **Supabase + React**, the most common path.

For other backends, see [Adapters](adapters.md). For non-React usage, see [Vanilla JS](vanilla-js.md).

## 1. Install

```bash
bun add @sylergydigital/impersonate-sdk
# or
npm install @sylergydigital/impersonate-sdk
```

## 2. Deploy the Server Endpoint

### Supabase Edge Function (recommended — SDK CLI)

The SDK ships a CLI that scaffolds and deploys the edge function for you:

```bash
npx impersonate-sdk init     # copies edge fn → supabase/functions/impersonate-user,
                             # writes supabase/.env, prints provider snippet

supabase link --project-ref <your-project-ref>   # if not already linked
                                                 # (skip on the zero-CLI path below)

npx impersonate-sdk deploy   # pushes secrets + deploys the function
```

`deploy` automatically chooses between two paths:

- **Zero-CLI (Management API)** — set `SUPABASE_ACCESS_TOKEN` (create a PAT at https://supabase.com/dashboard/account/tokens) and `SUPABASE_PROJECT_REF` in `.env`, `.env.local`, or `supabase/.env`. No `supabase` binary required.
- **Supabase CLI** — used when no PAT is found. Requires `supabase login` + `supabase link` to have been run.

`init` prompts for `IMPERSONATION_ADMIN_ROLES` (comma-separated, default `admin`). Schema columns for role and display name are auto-detected on the `profiles` table — override only if auto-detect fails:

- `IMPERSONATION_ROLE_TABLE` / `IMPERSONATION_ROLE_COLUMN`
- `IMPERSONATION_NAME_TABLE` / `IMPERSONATION_NAME_COLUMN`

### Supabase Edge Function (manual fallback)

If the CLI cannot run in the environment:

```bash
cp -r node_modules/@sylergydigital/impersonate-sdk/servers/supabase/impersonate-user \
  supabase/functions/impersonate-user
```

Set `IMPERSONATION_ADMIN_ROLES` in the Supabase dashboard under Edge Function secrets, then:

```bash
supabase functions deploy impersonate-user
```

### Express

See the template at `servers/express/impersonate.ts` for Express middleware setup.

## 3. Add the Provider

```tsx
import {
  createSupabaseImpersonation,
  ImpersonationProvider,
  ImpersonationBanner,
} from '@sylergydigital/impersonate-sdk/supabase-react';
import { supabase } from './lib/supabase';

const manager = createSupabaseImpersonation({
  supabaseClient: supabase,
  durationMinutes: 15,
});

function App() {
  return (
    <ImpersonationProvider
      manager={manager}
      onStart={(name) => navigate('/dashboard')}
      onStop={() => navigate('/admin/users')}
    >
      <ImpersonationBanner />
      <Routes>{/* your routes */}</Routes>
    </ImpersonationProvider>
  );
}
```

Alternatively, pass config directly to the provider (no manager variable):

```tsx
import { SupabaseAdapter, ImpersonationProvider, ImpersonationBanner }
  from '@sylergydigital/impersonate-sdk/supabase-react';

function App() {
  return (
    <ImpersonationProvider config={{
      adapter: new SupabaseAdapter({ supabaseClient: supabase }),
      durationMinutes: 15,
    }}>
      <ImpersonationBanner />
      <Routes>{/* your routes */}</Routes>
    </ImpersonationProvider>
  );
}
```

## 4. Trigger from Any Component

```tsx
import { useImpersonation } from '@sylergydigital/impersonate-sdk/supabase-react';

function UserRow({ user }) {
  const { start } = useImpersonation();

  return (
    <tr>
      <td>{user.name}</td>
      <td>
        <button onClick={() => start(user.id)}>Impersonate</button>
      </td>
    </tr>
  );
}
```

## Entry Points

| Import Path | Use Case |
| --- | --- |
| `@sylergydigital/impersonate-sdk` | Core manager, types, and constants (any framework) |
| `@sylergydigital/impersonate-sdk/react` | React provider, hook, and banner component |
| `@sylergydigital/impersonate-sdk/supabase-react` | All-in-one for Supabase + React projects |
| `@sylergydigital/impersonate-sdk/adapters/supabase` | Supabase adapter + factory |
| `@sylergydigital/impersonate-sdk/adapters/generic` | Generic HTTP adapter + factory |

## 5. Router Handoff (if the project has a router)

So `onStart` / `onStop` navigate via the project's router instead of a hard reload, use the matching hook:

```tsx
// react-router v6/v7
import { useReactRouterHandoff }
  from '@sylergydigital/impersonate-sdk/react/router/react-router';

const handoff = useReactRouterHandoff({ adminPath: '/admin/users', userPath: '/' });

<ImpersonationProvider manager={manager} {...handoff}>
  <ImpersonationBanner />
  {children}
</ImpersonationProvider>
```

Available hooks: `useReactRouterHandoff` (`@/react/router/react-router`), `useNextHandoff` (`@/react/router/next`), `useTanstackHandoff` (`@/react/router/tanstack`).

## 6. Guard the Sign-Out

Swap the existing sign-out for the SDK hook so impersonation stops first (which restores the admin session) instead of signing the admin out:

```tsx
import { useGuardedSignOut } from '@sylergydigital/impersonate-sdk/supabase-react';

const signOut = useGuardedSignOut(supabase);
```

## Optional: `impersonate.config.ts`

Share config between the CLI (which writes `supabase/.env` and pushes secrets) and your app:

```ts
import { defineImpersonationConfig } from '@sylergydigital/impersonate-sdk/config';

export default defineImpersonationConfig({
  adminRoles: ['admin', 'superadmin'],
  routes: { adminPath: '/admin/users', userPath: '/' },
});
```

Run `npx impersonate-sdk sync` after editing to rewrite `supabase/.env`. The Deno edge function cannot import this file directly — the CLI bridges it to Supabase secrets.

## Next Steps

- [Adapters](adapters.md) -- connect to Django, Flask, Express, or write a custom adapter
- [React API](react-api.md) -- provider, hook, banner, and theming reference
- [Configuration](configuration.md) -- all available options
- [Security](security.md) -- security model and best practices
