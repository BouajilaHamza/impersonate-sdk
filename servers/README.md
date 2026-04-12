# Server Templates

These are reference implementations for the server-side impersonation endpoint.
Copy the one that matches your backend and adapt it to your auth system.

## Available Templates

### Supabase Edge Function (`supabase/`)
For Supabase projects. Uses `auth.admin.generateLink()` to create a magic link token.

**Setup:**
1. Copy `supabase/impersonate-user/` to your project's `supabase/functions/`
2. Set environment variables in Supabase dashboard:
   - `IMPERSONATION_ADMIN_ROLE_ID` (required)
   - `IMPERSONATION_ROLE_TABLE` (default: `profiles`)
   - `IMPERSONATION_ROLE_COLUMN` (default: `role_id`)
   - `IMPERSONATION_NAME_TABLE` (default: `profiles`)
   - `IMPERSONATION_NAME_COLUMN` (default: `full_name`)
3. Deploy: `supabase functions deploy impersonate-user`

### Express Middleware (`express/`)
For Express/Node.js backends. Reference implementation showing the expected API contract.

**The contract:** Your server endpoint must accept:
```
POST /api/admin/impersonate
Body: { "target_user_id": "..." }
Response: { "session_id": "...", "target_user_name": "..." }
```

### Writing Your Own
Any backend that exposes a POST endpoint returning session data works with the `GenericHTTPAdapter`.
See the SDK README for integration examples with Django, Flask, and other frameworks.
