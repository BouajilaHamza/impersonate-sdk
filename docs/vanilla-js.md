# Vanilla JS

The core works without React or any framework. Use event listeners to build your own UI.

## Setup

```ts
import { createSupabaseImpersonation } from '@sylergydigital/impersonate-sdk/adapters/supabase';

const manager = createSupabaseImpersonation({
  supabaseClient: supabase,
  durationMinutes: 15,
});
```

## Events

```ts
manager.on('started', ({ targetDisplayName }) => {
  showBanner(targetDisplayName);
});

manager.on('tick', ({ remainingSeconds }) => {
  updateCountdown(remainingSeconds);
});

manager.on('expiring', ({ remainingSeconds }) => {
  showUrgentStyling();
});

manager.on('stopped', ({ reason }) => {
  hideBanner();
  if (reason === 'timeout') redirectToAdmin();
});

manager.on('error', ({ error, phase }) => {
  console.error(`Error during ${phase}:`, error);
});
```

All event subscriptions return an unsubscribe function:

```ts
const unsub = manager.on('tick', handler);
// Later:
unsub();
```

### Event Reference

| Event | Payload | When |
| --- | --- | --- |
| `started` | `{ targetDisplayName, metadata? }` | Impersonation session established |
| `stopped` | `{ reason: 'manual' \| 'timeout' \| 'orphan' }` | Session ended |
| `tick` | `{ remainingMs, remainingSeconds }` | Every tick (default: 1s) |
| `expiring` | `{ remainingSeconds }` | Timer enters urgent phase |
| `expired` | `{}` | Timer hit zero |
| `extended` | `{ newExpiresAt }` | Timer was extended |
| `error` | `{ error, phase }` | Error during start/stop/extend |
| `statechange` | `{ state }` | Any state change |

## Actions

```ts
// Start impersonating
await manager.start(targetUserId);

// Stop and restore admin session
await manager.stop();

// Extend the timer
manager.extend();

// Read current state
const state = manager.getState();
// { status, targetDisplayName, remainingSeconds, canExtend, isUrgent, ... }

// Check for orphaned sessions (call on app mount)
if (manager.checkForOrphan()) {
  console.warn('Found orphaned impersonation session');
}

// Clean up when done
manager.destroy();
```

## Sign-Out Guard

Prevent accidental sign-outs during impersonation:

```ts
const signOut = async () => {
  const state = manager.getState();
  if (state.status === 'active') {
    await manager.stop();
    return;
  }
  await supabase.auth.signOut();
};
```
