# React API

All React exports are available from `@sylergydigital/impersonate-sdk/react` or the convenience path `@sylergydigital/impersonate-sdk/supabase-react`.

## `<ImpersonationProvider>`

Wrap your app to provide impersonation context to all child components.

### With a Manager

```tsx
<ImpersonationProvider
  manager={manager}
  onStart={(targetName) => navigate('/dashboard')}
  onStop={(reason) => navigate('/admin/users')}
  onError={(error, phase) => console.error(phase, error)}
>
  {children}
</ImpersonationProvider>
```

### With Inline Config

The provider can create the manager internally -- no variable needed:

```tsx
<ImpersonationProvider config={{
  adapter: new SupabaseAdapter({ supabaseClient: supabase }),
  durationMinutes: 15,
}}>
  {children}
</ImpersonationProvider>
```

The manager is created once on mount and destroyed on unmount.

### Props

| Prop | Type | Description |
| --- | --- | --- |
| `manager` | `ImpersonationManager` | A pre-built manager instance (mutually exclusive with `config`) |
| `config` | `ImpersonationConfig` | Config to create the manager internally (mutually exclusive with `manager`) |
| `onStart` | `(targetName: string) => void` | Called after impersonation starts |
| `onStop` | `(reason: 'manual' \| 'timeout' \| 'orphan' \| 'restore-failed') => void` | Called after impersonation stops |
| `onError` | `(error: Error, phase: 'start' \| 'stop' \| 'extend') => void` | Called on error |

#### `onStop` reasons

- `manual` — the admin clicked "End Impersonation".
- `timeout` — the impersonation timer expired and the admin session was restored cleanly.
- `orphan` — a stale impersonation session was detected on app mount (e.g. tab was closed mid-session) and cleaned up.
- `restore-failed` — the admin session could not be restored (typically a transient network failure on the auth backend, e.g. Supabase's `setSession` `_getUser` call failing in a backgrounded tab). The SDK has already best-effort signed the impersonated user out via the adapter's `clearSession` hook, so the client is unauthenticated. Your `onStop` handler should redirect to a safe location (login or admin home). Use `onError` (phase `"stop"`) if you want to additionally surface a toast.

## `useImpersonation()`

Access state and actions from any component inside the provider.

```ts
const {
  isActive,           // boolean
  isTransitioning,    // boolean (during start/stop)
  status,             // 'idle' | 'starting' | 'active' | 'stopping'
  targetDisplayName,  // string | null
  metadata,           // Record<string, unknown> | null
  remainingSeconds,   // number | null
  remainingMs,        // number | null
  canExtend,          // boolean
  isUrgent,           // boolean (< 60s remaining)
  start,              // (targetUserId: string) => Promise<void>
  stop,               // () => Promise<void>
  extend,             // () => void
} = useImpersonation();
```

Throws if used outside an `<ImpersonationProvider>`.

## `<ImpersonationBanner>`

Drop-in notification bar. Renders nothing when impersonation is inactive.

### Default Banner

```tsx
<ImpersonationBanner
  onEnd={() => navigate('/admin')}
  extendLabel="Extend 15 min"
  endLabel="End Impersonation"
/>
```

### Headless Mode

Bring your own UI with the `render` prop:

```tsx
<ImpersonationBanner
  render={({ targetDisplayName, remainingSeconds, formatTime, onEnd, onExtend, canExtend, isUrgent }) => (
    <div className="my-banner">
      Viewing as {targetDisplayName} -- {formatTime(remainingSeconds)}
      {canExtend && <button onClick={onExtend}>Extend</button>}
      <button onClick={onEnd}>Stop</button>
    </div>
  )}
/>
```

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `onEnd` | `() => void \| Promise<void>` | Calls `stop()` | Custom end handler |
| `extendLabel` | `string` | `"Extend 15 min"` | Extend button text |
| `endLabel` | `string` | `"End Impersonation"` | End button text |
| `maxTimeLabel` | `string` | `"Max time reached"` | Shown when extend is unavailable |
| `className` | `string` | -- | Additional CSS class |
| `style` | `CSSProperties` | -- | Additional inline styles |
| `render` | `(props) => ReactNode` | -- | Headless render prop |

### Theming

Override CSS custom properties to match your app's design:

```css
:root {
  --imp-banner-bg: #6366f1;
  --imp-banner-text: #ffffff;
  --imp-banner-urgent-bg: #dc2626;
  --imp-banner-urgent-text: #ffffff;
  --imp-timer-bg: rgba(79, 70, 229, 0.5);
  --imp-timer-text: #ffffff;
  --imp-end-border: #4338ca;
  --imp-end-bg: #4f46e5;
  --imp-end-text: #ffffff;
}
```
