# Supabase for Track2College

Cloud auth and persistence for accounts, profiles, advisor chats, transcripts, analyses, course plans, and the birthday/birthplace from the voice counselor call.

## What’s configured

| Capability | Status |
| ---------- | ------ |
| Auth (email/password, confirm email, password reset) | Frontend via `@supabase/supabase-js` |
| `profiles` | RLS table, JSON `data` |
| `profile_analyses` | RLS table |
| `game_progress` | RLS table (story-mode progress and mentor settings) |
| `personal_info` | RLS table, JSON `data`: `{ "birthDate": "YYYY-MM-DD", "birthCountry", "birthCity" }`. Written by the voice counselor (Apply → Talk to a counselor), read when filling UC's *About you → Personal information*. Kept out of `profiles` on purpose. |
| `conversations` | RLS table |
| `transcripts` | RLS table |
| `course_plans` | RLS table |
| Storage bucket `transcripts` | Private; path `<user_id>/<transcript_id>/<file>` |

Every table has one row (or set of rows) per user, keyed by `user_id`, with the same row-level security rule: a signed-in user can only read and write their own rows.

Schema source of truth: [`schema.sql`](./schema.sql). Applied to the linked project with MCP as migrations `track2college_tables_and_rls` and `create_personal_info`.

**Editing `schema.sql` doesn't change the live database.** After adding or changing a table there, apply it to the project too (see *Re-apply schema* below). Until you do, the app's reads and writes to that table fail. Supabase answers `Could not find the table 'public.<name>' in the schema cache` (error `PGRST205`), and some features fail silently.

## Frontend env

Set these in the root `.env` (gitignored; template in `.env.example`):

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

In the SQL editor, paste `schema.sql`, or use the Supabase MCP `apply_migration` tool with that SQL. Every statement is safe to re-run (`create … if not exists`, policies dropped and re-created), so pasting the whole file is fine even when only one table is new.

Make sure the dashboard is open on the **same project** as `VITE_SUPABASE_URL` in the root `.env`. With more than one project, this is the easiest thing to mix up.

If the app still says the table isn't found right after you apply it, refresh Supabase's API cache:

```sql
notify pgrst, 'reload schema';
```

### Check a table is live

From the project root, this asks the app's API for the table without reading anyone's data:

```bash
set -a; . ./.env; set +a
curl -s "$VITE_SUPABASE_URL/rest/v1/personal_info?select=user_id&limit=1" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
```

`[]` means the table exists (row-level security hides other users' rows). `PGRST205` means it hasn't been applied to this project yet.

### Look up one student's saved birthday and birthplace

1. **Authentication → Users**: find the account by email and copy its **User UID**.
2. **Table Editor → `personal_info`**: open the row whose `user_id` matches. Its `data` column holds `birthDate`, `birthCountry`, and `birthCity`.

No row means the voice call didn't save. Check the table is live (above), then talk to the counselor again.
