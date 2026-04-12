# @sylergydigital/impersonate-sdk

Universal admin impersonation for any web app. Let admins "view as" any user with a single SDK.

Auth-agnostic core with adapters for **Supabase**, **Firebase**, **Django**, **Flask**, **Express**, and any REST backend.

## Features

- **Auth-agnostic** -- adapter pattern works with any auth backend
- **Auto-expiry timer** -- 15-minute default with configurable hard cap
- **Built-in banner** -- sticky notification bar with countdown, extend, and end actions
- **Page-refresh survival** -- timer, session, and display name persist through refreshes
- **Cross-tab safety** -- detects orphaned impersonation sessions
- **Headless mode** -- use the hook for fully custom UI
- **Tree-shakeable** -- separate entry points for core, React, and each adapter
- **Zero dependencies** -- core is pure TypeScript

## Quick Start (Supabase + React)

```bash
bun add @sylergydigital/impersonate-sdk
```

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

## Documentation

| Guide | Description |
| --- | --- |
| [Getting Started](docs/getting-started.md) | Full setup walkthrough with server deployment |
| [Adapters](docs/adapters.md) | Supabase, Generic HTTP, and custom adapter guides |
| [React API](docs/react-api.md) | Provider, hook, banner, theming, and headless mode |
| [Vanilla JS](docs/vanilla-js.md) | Using the core without React |
| [Configuration](docs/configuration.md) | All options with defaults |
| [Security](docs/security.md) | Security model and best practices |

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
