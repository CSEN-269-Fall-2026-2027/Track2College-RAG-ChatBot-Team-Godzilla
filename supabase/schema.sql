-- Track2College schema for Supabase.
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
-- Table/bucket names must match frontend/src/data/supabase.ts.
-- Each record's full JSON lives in `data`; the frontend owns its shape (see frontend/src/types.ts).

-- ---------------------------------------------------------------------------
-- Per-user singletons
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_analyses (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Story-mode progress: XP, achievements, mentor affinity and settings (frontend/src/game/progress.ts).
create table if not exists public.game_progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Per-user collections
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.transcripts (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.course_plans (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_idx on public.conversations (user_id, updated_at desc);
create index if not exists transcripts_user_idx   on public.transcripts   (user_id, updated_at desc);
create index if not exists course_plans_user_idx  on public.course_plans  (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: every user can only see and change their own rows.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'profile_analyses', 'game_progress', 'conversations', 'transcripts', 'course_plans'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Users manage own rows" on public.%I', t);
    execute format(
      'create policy "Users manage own rows" on public.%I for all to authenticated '
      'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Private storage for original transcript files, stored at <user_id>/<transcript_id>/<file>.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transcripts', 'transcripts', false, 5242880, array['application/pdf', 'text/plain', 'text/csv'])
on conflict (id) do nothing;

drop policy if exists "Users manage own transcript files" on storage.objects;
create policy "Users manage own transcript files" on storage.objects
  for all to authenticated
  using (bucket_id = 'transcripts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'transcripts' and (storage.foldername(name))[1] = (select auth.uid())::text);
