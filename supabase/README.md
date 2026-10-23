# Supabase for Track2College

Cloud auth and persistence for accounts, profiles, advisor chats, transcripts, analyses, and course plans.

## What’s configured

| Capability | Status |
| ---------- | ------ |
| Auth (email/password, confirm email, password reset) | Frontend via `@supabase/supabase-js` |
| `profiles` | RLS table, JSON `data` |
| `profile_analyses` | RLS table |
| `conversations` | RLS table |
| `transcripts` | RLS table |
| `course_plans` | RLS table |
| Storage bucket `transcripts` | Private; path `<user_id>/<transcript_id>/<file>` |

Schema source of truth: [`schema.sql`](./schema.sql). Applied to the linked project with MCP as migration `track2college_tables_and_rls`.

## Frontend env

Copy into `frontend/.env.local` (gitignored):

```bash
VITE_API_URL=http://127.0.0.1:8000
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

Both values are **required**. The app no longer has a localStorage account fallback.

## Dashboard checklist

1. Open the project and wait until status is **Active / healthy** (resume if paused).
2. **Authentication → Providers**: Email enabled.
3. **Authentication → URL configuration**: add your app origin (e.g. `http://localhost:5500`) for password-reset redirects.
4. **Storage**: confirm the `transcripts` bucket exists (re-run the storage section of `schema.sql` if the project was restored without Storage tables).
5. Optional: disable “Confirm email” under Auth for faster local testing.

## Re-apply schema

In the SQL editor, paste `schema.sql`, or use the Supabase MCP `apply_migration` tool with that SQL.
