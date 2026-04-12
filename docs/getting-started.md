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

### Supabase Edge Function

Copy the included server template to your Supabase project:

```bash
cp -r node_modules/@sylergydigital/impersonate-sdk/servers/supabase/impersonate-user \
  supabase/functions/impersonate-user
```

Set the required environment variable in your Supabase dashboard:

```
IMPERSONATION_ADMIN_ROLE_ID=your-admin-role-uuid
```

Deploy:

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

## Next Steps

- [Adapters](adapters.md) -- connect to Django, Flask, Express, or write a custom adapter
- [React API](react-api.md) -- provider, hook, banner, and theming reference
- [Configuration](configuration.md) -- all available options
- [Security](security.md) -- security model and best practices
