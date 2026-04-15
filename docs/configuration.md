# Configuration

## Manager Options

```ts
import { ImpersonationManager } from '@sylergydigital/impersonate-sdk';

const manager = new ImpersonationManager({
  adapter: myAdapter,
  durationMinutes: 15,
  maxDurationMinutes: 60,
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `adapter` | `ImpersonationAdapter` | -- | **Required.** The auth adapter to use |
| `durationMinutes` | `number` | `15` | Duration of each impersonation window |
| `maxDurationMinutes` | `number` | `60` | Hard cap on total time (including extensions) |
| `durationMs` | `number` | `900000` | Duration in milliseconds (use `durationMinutes` instead) |
| `maxDurationMs` | `number` | `3600000` | Hard cap in milliseconds (use `maxDurationMinutes` instead) |
| `storagePrefix` | `string` | `"impersonate"` | Storage key prefix to avoid collisions |
| `tickIntervalMs` | `number` | `1000` | How often the timer ticks (updates UI) |
| `urgentThresholdSeconds` | `number` | `60` | Seconds remaining before urgent styling activates |
| `storage` | `StorageBackend` | Browser storage | Custom storage backend for SSR or testing |

When both `durationMinutes` and `durationMs` are set, `durationMinutes` takes precedence. Same for `maxDurationMinutes` vs `maxDurationMs`.

## Factory Functions

Factory functions combine adapter creation and manager creation into one call. All manager options are accepted alongside adapter-specific options.

### Supabase

```ts
import { createSupabaseImpersonation } from '@sylergydigital/impersonate-sdk/adapters/supabase';

const manager = createSupabaseImpersonation({
  supabaseClient: supabase,     // Required
  functionName: 'impersonate-user', // Default
  durationMinutes: 15,          // + any manager option
});
```

### Generic HTTP

```ts
import { createGenericImpersonation } from '@sylergydigital/impersonate-sdk/adapters/generic';

const manager = createGenericImpersonation({
  startUrl: '/api/impersonate/', // Required
  signIn: async (data) => {},    // Required
  durationMinutes: 15,           // + any manager option
});
```

## Custom Storage Backend

For SSR or testing environments where `window.sessionStorage` / `window.localStorage` are unavailable:

```ts
const manager = new ImpersonationManager({
  adapter: myAdapter,
  storage: {
    session: {
      getItem: (key) => myStore.get(key),
      setItem: (key, value) => myStore.set(key, value),
      removeItem: (key) => myStore.delete(key),
    },
    local: {
      getItem: (key) => myStore.get(key),
      setItem: (key, value) => myStore.set(key, value),
      removeItem: (key) => myStore.delete(key),
    },
  },
});
```

The SDK falls back to in-memory storage automatically when `window` is undefined.

## Supabase Edge Function Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `IMPERSONATION_ADMIN_ROLES` | Yes | -- | Comma-separated role values allowed to impersonate (e.g. `admin,superadmin`) |
| `IMPERSONATION_ROLE_TABLE` | No | `profiles` | Table to check user role |
| `IMPERSONATION_ROLE_COLUMN` | No | auto-detect | Auto-detected from `role`, `role_id`, `user_role`. Set to override. |
| `IMPERSONATION_NAME_TABLE` | No | `profiles` | Table to read display name from |
| `IMPERSONATION_NAME_COLUMN` | No | auto-detect | Auto-detected from `display_name`, `full_name`, `name`. Set to override. |
