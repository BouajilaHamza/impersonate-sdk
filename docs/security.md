# Security

## Security Model

Impersonation is a sensitive operation. The SDK enforces several layers of protection.

### Server-Side Validation

The edge function or endpoint verifies the admin role before generating any session tokens. The client never decides who is allowed to impersonate -- that decision is always server-side.

### Real Sessions

Impersonation creates a genuine auth session for the target user. This means Row Level Security (RLS), permissions, and access controls are enforced exactly as they would be for that user. The admin sees what the user sees -- nothing more, nothing less.

### Session Isolation

Admin session tokens are stored in `sessionStorage`, which is per-tab and not shared across browser tabs. This prevents one tab's impersonation from leaking into another tab.

### Auto-Expiry

Sessions expire automatically after the configured duration (default: 15 minutes). A hard cap (default: 60 minutes) limits extensions. There is no way to impersonate indefinitely.

### Nested Prevention

The SDK rejects attempts to start a second impersonation while one is already active. This prevents session stacking attacks.

### Orphan Detection

If a tab is closed during impersonation, the SDK detects the orphaned session on next app load using a `localStorage` flag. The orphan is cleaned up and the `onStop` callback fires with reason `"orphan"`.

## Recommendations

- **Audit logging** -- log all impersonation start/stop events server-side with admin ID, target user ID, and timestamp
- **Rate limiting** -- limit how many impersonation sessions an admin can start per hour
- **Notification** -- consider notifying users when their account has been impersonated (post-session)
- **Role restrictions** -- only allow specific admin roles to impersonate, not all authenticated users
- **Sensitive action blocking** -- consider blocking destructive actions (delete account, change password) during impersonation
