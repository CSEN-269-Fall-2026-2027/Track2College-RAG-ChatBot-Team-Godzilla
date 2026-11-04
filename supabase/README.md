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
