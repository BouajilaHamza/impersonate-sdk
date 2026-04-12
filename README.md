# @sylergydigital/impersonate-sdk

Universal admin impersonation for any web app. Let admins "view as" any user with a single SDK.

Auth-agnostic core with adapters for **Supabase**, **Firebase**, **Django**, **Flask**, **Express**, and any REST backend.

## Features

- **Auth-agnostic** -- adapter pattern works with any auth backend
- **Auto-expiry timer** -- 15-minute default with configurable hard cap (60 min)
- **Built-in banner** -- sticky notification bar with countdown, extend, and end actions
- **Cross-tab safety** -- detects orphaned impersonation sessions
- **Page-refresh survival** -- timer and session persist through refreshes
- **Headless mode** -- use the hook directly for custom UI
- **Zero CSS dependency** -- banner uses inline styles with CSS custom property theming
- **Tree-shakeable** -- separate entry points for core, React, and each adapter

## Quick Start (Supabase + React)

### 1. Install

```bash
npm install @sylergydigital/impersonate-sdk
# or
bun add @sylergydigital/impersonate-sdk
```

### 2. Deploy the Edge Function

Copy `servers/supabase/impersonate-user/` to your project:

```bash
cp -r node_modules/@sylergydigital/impersonate-sdk/servers/supabase/impersonate-user \
  supabase/functions/impersonate-user
```

Set environment variables in your Supabase dashboard:

```
IMPERSONATION_ADMIN_ROLE_ID=your-admin-role-uuid
```

Deploy:

```bash
supabase functions deploy impersonate-user
```

### 3. Integrate

```tsx
// app.tsx
import { ImpersonationManager } from '@sylergydigital/impersonate-sdk';
import { SupabaseAdapter } from '@sylergydigital/impersonate-sdk/adapters/supabase';
import {
  ImpersonationProvider,
  ImpersonationBanner,
} from '@sylergydigital/impersonate-sdk/react';
import { supabase } from './lib/supabase';

const manager = new ImpersonationManager({
  adapter: new SupabaseAdapter({ supabaseClient: supabase }),
});

function App() {
  const navigate = useNavigate();

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

### 4. Trigger from Any Component

```tsx
import { useImpersonation } from '@sylergydigital/impersonate-sdk/react';

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

## Architecture

```
+-------------------------------------------------+
|  Server Templates (edge functions, middleware)   |
+-------------------------------------------------+
|  UI Bindings (React provider, hook, banner)      |
+-------------------------------------------------+
|  Auth Adapters (Supabase, Generic HTTP, ...)     |
+-------------------------------------------------+
|  Core (manager, timer, storage, events)          |
+-------------------------------------------------+
|  Adapter Protocol (4-method interface)           |
+-------------------------------------------------+
```

The core is pure TypeScript with zero dependencies. Auth-specific logic lives in adapters.
React bindings are optional. The core can be used with vanilla JS, Vue, Svelte, or any framework.

## Adapters

### Supabase Adapter

```ts
import { SupabaseAdapter } from '@sylergydigital/impersonate-sdk/adapters/supabase';

const adapter = new SupabaseAdapter({
  supabaseClient: supabase,
  functionName: 'impersonate-user', // default
});
```

Uses Supabase's magic link flow: edge function generates a token, client verifies OTP.

### Generic HTTP Adapter

For Django, Flask, Express, or any REST backend:

```ts
import { GenericHTTPAdapter } from '@sylergydigital/impersonate-sdk/adapters/generic';

const adapter = new GenericHTTPAdapter({
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
});
```

### Writing a Custom Adapter

Implement the `ImpersonationAdapter` interface:

```ts
import type { ImpersonationAdapter } from '@sylergydigital/impersonate-sdk';

class MyAdapter implements ImpersonationAdapter {
  async saveCurrentSession() {
    // Return { data: <whatever your session looks like> }
  }
  async createImpersonatedSession(targetUserId: string) {
    // Call your server, establish session, return { targetDisplayName }
  }
  async restoreSession(snapshot) {
    // Restore admin session from snapshot.data
  }
  // Optional:
  async destroyImpersonatedSession() {
    // Clean up impersonated session before restoring admin
  }
}
```

## Configuration

```ts
const manager = new ImpersonationManager({
  adapter: myAdapter,           // Required: the auth adapter
  durationMs: 15 * 60 * 1000,  // Session duration (default: 15 min)
  maxDurationMs: 60 * 60 * 1000, // Hard cap (default: 60 min)
  storagePrefix: 'impersonate', // Storage key prefix (default)
  tickIntervalMs: 1000,         // Timer tick interval (default: 1s)
  urgentThresholdSeconds: 60,   // When to show urgent styling (default: 60s)
});
```

## React API

### `<ImpersonationProvider>`

```tsx
<ImpersonationProvider
  manager={manager}
  onStart={(targetName) => { /* navigate */ }}
  onStop={(reason) => { /* reason: 'manual' | 'timeout' | 'orphan' */ }}
  onError={(error, phase) => { /* phase: 'start' | 'stop' | 'extend' */ }}
>
  {children}
</ImpersonationProvider>
```

### `useImpersonation()`

```ts
const {
  isActive,           // boolean
  isTransitioning,    // boolean (during start/stop)
  status,             // 'idle' | 'starting' | 'active' | 'stopping'
  targetDisplayName,  // string | null
  remainingSeconds,   // number | null
  canExtend,          // boolean
  isUrgent,           // boolean (< 60s remaining)
  start,              // (targetUserId: string) => Promise<void>
  stop,               // () => Promise<void>
  extend,             // () => void
} = useImpersonation();
```

### `<ImpersonationBanner>`

```tsx
// Default styled banner
<ImpersonationBanner
  onEnd={() => navigate('/admin')}
  extendLabel="Extend 15 min"
  endLabel="End Impersonation"
/>

// Headless mode (custom UI)
<ImpersonationBanner
  render={({ targetDisplayName, remainingSeconds, formatTime, onEnd, onExtend }) => (
    <div className="my-custom-banner">
      Viewing as {targetDisplayName} - {formatTime(remainingSeconds)}
      <button onClick={onExtend}>Extend</button>
      <button onClick={onEnd}>Stop</button>
    </div>
  )}
/>
```

#### Banner Theming

Override CSS custom properties:

```css
:root {
  --imp-banner-bg: #6366f1;         /* Normal background */
  --imp-banner-text: #ffffff;        /* Normal text */
  --imp-banner-urgent-bg: #dc2626;   /* Urgent background */
  --imp-banner-urgent-text: #ffffff;  /* Urgent text */
  --imp-timer-bg: rgba(79, 70, 229, 0.5);
  --imp-timer-text: #ffffff;
  --imp-end-border: #4338ca;
  --imp-end-bg: #4f46e5;
  --imp-end-text: #ffffff;
}
```

## Vanilla JS (No React)

```ts
import { ImpersonationManager } from '@sylergydigital/impersonate-sdk';
import { SupabaseAdapter } from '@sylergydigital/impersonate-sdk/adapters/supabase';

const manager = new ImpersonationManager({
  adapter: new SupabaseAdapter({ supabaseClient: supabase }),
});

manager.on('started', ({ targetDisplayName }) => {
  showBanner(targetDisplayName);
});

manager.on('tick', ({ remainingSeconds }) => {
  updateCountdown(remainingSeconds);
});

manager.on('stopped', ({ reason }) => {
  hideBanner();
  if (reason === 'timeout') redirectToAdmin();
});

manager.on('expiring', () => {
  showUrgentStyling();
});

// Start
await manager.start(targetUserId);

// Stop
await manager.stop();

// Extend
manager.extend();

// Check state
const state = manager.getState();
```

## Sign-Out Guard

Integrate with your existing auth context to prevent accidental sign-outs:

```ts
const { isActive, stop } = useImpersonation();

const signOut = async () => {
  if (isActive) {
    await stop(); // Restores admin session instead of signing out
    return;
  }
  await supabase.auth.signOut();
};
```

## Security

- **Server-side validation** -- the edge function/endpoint verifies admin role, never trust the client
- **Real sessions** -- impersonation creates a genuine auth session, so RLS/permissions are enforced
- **Session isolation** -- admin tokens are stored in sessionStorage (per-tab, not shared)
- **Auto-expiry** -- sessions expire automatically, no indefinite impersonation
- **Nested prevention** -- cannot start a second impersonation while one is active
- **Orphan detection** -- detects and cleans up sessions from crashed/closed tabs

## Roadmap

| Version | Scope |
|---------|-------|
| **0.1** | Core + Supabase adapter + Generic HTTP adapter + React bindings |
| 0.2 | Firebase adapter + Cloud Function template |
| 0.3 | Vue composable + Svelte store bindings |
| 0.4 | Django/Flask server templates |
| 1.0 | Audit trail, rate limiting, docs site |

## License

MIT
