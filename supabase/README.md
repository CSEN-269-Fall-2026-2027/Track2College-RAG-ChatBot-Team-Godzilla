# Supabase setup

Supabase handles email sign-in, student data, and private transcript uploads.

1. Create or open your Supabase project.
2. Paste [schema.sql](schema.sql) into its SQL editor and run it. It creates the
   tables, per-user access policies, and private `transcripts` bucket.
3. Enable email sign-in under Authentication. Add `http://localhost:5500` to the
   allowed redirect URLs for password resets.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the root `.env` using
   the same project's URL and public anon/publishable key. Never use a
   service-role or secret key in the frontend.
5. Restart the frontend and create an account. If email confirmation is enabled,
   confirm your email before signing in.

The frontend requires Supabase; there is no local account fallback. Each table
uses row-level security so signed-in users can access only their own records.
Transcript uploads use paths under the user's ID in the private bucket.

## Schema changes

Editing `schema.sql` doesn't update the live database. Run it again in the same
project's SQL editor after a schema change. The current script can be rerun;
`create table if not exists` won't change columns on an existing table, so column
changes need an explicit migration.

If you see `PGRST205` (table not found), check that `.env` points to the right
project and apply the schema. If needed, refresh the API schema cache:

```sql
notify pgrst, 'reload schema';
```

The `personal_info` table stores birthday and birthplace from voice calls.
If it was missing during a call, apply the schema and repeat the call to save
those answers.

The `transcripts` storage bucket must allow `text/markdown` (and
`application/octet-stream`) so `.md` uploads match the Academic history UI.
Re-running `schema.sql` updates an existing bucket's `allowed_mime_types`.

The retired `profile_analyses`, `course_plans`, and `game_progress` tables are no
longer created on new installs. Existing tables are left intact to preserve stored
data, and Reset all data still clears them when present. No active feature reads
or writes those tables.

## Google connect

Students sign in with email/password, then **Connect Google** as the required second
onboarding step. OAuth grants readonly access to Gmail, Calendar, and Drive. The
backend uses this connection for activity suggestions and UC verification codes;
refresh tokens are encrypted and stored only on the server (`google_connections`).

### Google Cloud Console

1. Create or open a Google Cloud project.
2. Enable the **Gmail API**, **Google Calendar API**, and **Google Drive API**.
3. Configure the OAuth consent screen (External is fine for testing). Add your
   account as a **test user** while the app is in Testing.
4. Create an **OAuth 2.0 Client ID** of type **Web application**.
5. Add authorized redirect URI:
   `http://127.0.0.1:8000/google/oauth/callback`
   (or whatever you set as `GOOGLE_REDIRECT_URI`).
6. Copy the client ID and secret into the root `.env` as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`. Set `GOOGLE_REDIRECT_URI`, `GOOGLE_FRONTEND_ORIGIN`
   (usually `http://localhost:5500`), and `GOOGLE_TOKEN_ENCRYPTION_KEY`
   (generate with the command in `.env.example`).
7. Add `SUPABASE_SERVICE_ROLE_KEY` from Supabase → Project Settings → API.
   Backend-only; never expose it as a `VITE_*` variable.
8. Re-run [schema.sql](schema.sql) so `google_connections` exists, then restart
   the API.

### Scopes and verification

Readonly scopes requested in one consent:

- `gmail.readonly` (restricted — public production needs Google’s restricted-scope
  verification / security assessment)
- `calendar.readonly` and `drive.readonly` (sensitive — usually need verification
  for a public OAuth app)

While the consent screen is in Testing, only listed test users can connect.
Shipping broadly with Gmail readonly requires Google’s verification process.
