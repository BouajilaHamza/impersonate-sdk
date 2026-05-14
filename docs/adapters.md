# Adapters

Adapters handle auth-specific session operations. The core handles everything else: timers, storage, events, and state machine.

## Supabase

```ts
import { createSupabaseImpersonation } from '@sylergydigital/impersonate-sdk/adapters/supabase';

const manager = createSupabaseImpersonation({
  supabaseClient: supabase,
  functionName: 'impersonate-user', // default
  durationMinutes: 15,
});
```

Uses Supabase's magic link flow: edge function generates a token, client verifies OTP to establish the target user's session.

If you need the adapter separately:

```ts
import { SupabaseAdapter } from '@sylergydigital/impersonate-sdk/adapters/supabase';

const adapter = new SupabaseAdapter({
  supabaseClient: supabase,
  functionName: 'impersonate-user',
});
```

## Generic HTTP (Django, Flask, Express, etc.)

```ts
import { createGenericImpersonation } from '@sylergydigital/impersonate-sdk/adapters/generic';
```

### Minimal Setup

For cookie-based auth, only `startUrl` and `signIn` are required. Session capture and restore use smart defaults (captures `document.cookie`, no-op restore since cookies persist naturally).

```ts
const manager = createGenericImpersonation({
  startUrl: '/api/admin/impersonate/',
  signIn: async (data) => {
    document.cookie = `sessionid=${data.session_id}; path=/`;
  },
  durationMinutes: 15,
});
```

### Full Control

Override session capture/restore for non-cookie auth (JWT, custom tokens, etc.):

```ts
const manager = createGenericImpersonation({
  startUrl: '/api/admin/impersonate/',
  getHeaders: async () => ({ 'X-CSRFToken': getCsrfToken() }),
  signIn: async (data) => {
    document.cookie = `sessionid=${data.session_id}; path=/`;
    location.reload();
  },
  getSession: async () => ({ sessionId: getCookie('sessionid') }),
  restoreSession: async (data) => {
    document.cookie = `sessionid=${data.sessionId}; path=/`;
    location.reload();
  },
  durationMinutes: 15,
});
```

### All Options

| Option | Required | Description |
| --- | --- | --- |
| `startUrl` | Yes | POST endpoint that creates the impersonated session |
| `signIn` | Yes | Establish the session client-side using the server response |
| `getSession` | No | Capture current session for later restoration. Default: `document.cookie` |
| `restoreSession` | No | Restore a previously saved session. Default: no-op |
| `signOut` | No | Sign out the impersonated session before restoring admin |
| `getHeaders` | No | Return custom headers (CSRF token, auth bearer, etc.) |
| `buildBody` | No | Build a custom request body. Default: `{ target_user_id }` |
| `getDisplayName` | No | Extract display name from the response. Default: reads `target_user_name` or `display_name` |

## Custom Adapter

Implement the `ImpersonationAdapter` interface (3 required methods, 2 optional):

```ts
import type { ImpersonationAdapter } from '@sylergydigital/impersonate-sdk';

class MyAdapter implements ImpersonationAdapter {
  async saveCurrentSession() {
    // Capture the current admin session
    return { data: /* your session snapshot */ };
  }

  async createImpersonatedSession(targetUserId: string) {
    // Call your server, establish the target user's session client-side
    return { targetDisplayName: 'Jane Doe' };
  }

  async restoreSession(snapshot) {
    // Restore admin session from snapshot.data
  }

  // Optional:
  async destroyImpersonatedSession() {
    // Clean up the impersonated session before restoring admin
  }

  // Optional but strongly recommended:
  async clearSession() {
    // Sign out the currently-active (impersonated) user.
    // Called by the core as a last resort when `restoreSession` fails inside
    // `stop()` — leaves the client unauthenticated instead of silently
    // impersonated. The built-in SupabaseAdapter implements this via
    // `supabase.auth.signOut()`. Implementations should throw on failure; the
    // core wraps the call in a try/catch.
  }
}
```

Then pass it to the manager:

```ts
import { ImpersonationManager } from '@sylergydigital/impersonate-sdk';

const manager = new ImpersonationManager({
  adapter: new MyAdapter(),
  durationMinutes: 15,
});
```
