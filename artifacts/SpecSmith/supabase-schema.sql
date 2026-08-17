-- SpecSmith public build gallery — run this once in your Supabase project's
-- SQL editor (Project → SQL Editor → New query → paste → Run).
--
-- Anonymous visitors can publish a build (INSERT) and browse the gallery
-- (SELECT). Nobody — including the publisher — can edit or delete a row
-- through the public API; there's no login system on SpecSmith to check
-- ownership against, so allowing UPDATE/DELETE for the anon key would let
-- any visitor tamper with anyone's listing. If you ever need to remove a
-- specific build, do it from the Supabase Table Editor directly.

create table if not exists public_builds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  build_state jsonb not null,
  creator_name text not null,
  total_cost integer not null,
  avg_fps integer not null,
  view_count integer not null default 0,
  -- True only for builds SpecSmith itself seeds when the gallery is sparse.
  -- The public insert policy below can never set this (no with-check clause
  -- grants it), so a build can only become a staff pick via a direct
  -- Table Editor / service-role insert — never through the public API.
  -- The Gallery UI renders these with a distinct badge; they must never be
  -- presented as organic user submissions.
  is_staff_pick boolean not null default false,
  created_at timestamptz not null default now()
);

-- Run this if public_builds already existed before is_staff_pick was added:
-- alter table public_builds add column if not exists is_staff_pick boolean not null default false;

alter table public_builds enable row level security;

create policy "Anyone can view public builds"
  on public_builds for select
  using (true);

create policy "Anyone can publish a build"
  on public_builds for insert
  with check (
    char_length(name) between 1 and 60
    and char_length(creator_name) between 1 and 40
    and total_cost >= 0
    and avg_fps >= 0
    -- Blocks a direct REST/anon-key insert from setting this itself —
    -- staff picks can only be created via the Table Editor / service role,
    -- which bypasses RLS entirely.
    and is_staff_pick = false
  );

-- Lets the gallery increment a build's view count without granting a
-- general UPDATE policy — this RPC only ever bumps view_count by 1 and
-- touches nothing else on the row.
create or replace function increment_build_views(build_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public_builds set view_count = view_count + 1 where id = build_id;
$$;

create index if not exists public_builds_created_at_idx on public_builds (created_at desc);
create index if not exists public_builds_view_count_idx on public_builds (view_count desc);

-- Build Crate global pulls feed — every finished crate run is recorded here
-- (fire-and-forget from the client) so the Crate page can show a live feed
-- of recent pulls across all visitors, not just a per-browser best-pull.
-- Same anon-insert/anon-select, no-update/delete policy as public_builds,
-- for the same reason: no login system to check ownership against.

create table if not exists crate_pulls (
  id uuid primary key default gen_random_uuid(),
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  gpu_name text not null,
  cpu_name text not null,
  build_state jsonb not null,
  total_cost integer not null,
  avg_fps integer not null,
  puller_name text not null default 'Anonymous',
  created_at timestamptz not null default now()
);

alter table crate_pulls enable row level security;

create policy "Anyone can view crate pulls"
  on crate_pulls for select
  using (true);

create policy "Anyone can record a crate pull"
  on crate_pulls for insert
  with check (
    char_length(gpu_name) between 1 and 80
    and char_length(cpu_name) between 1 and 80
    and char_length(puller_name) between 1 and 40
    and total_cost >= 0
    and avg_fps >= 0
  );

create index if not exists crate_pulls_created_at_idx on crate_pulls (created_at desc);
create index if not exists crate_pulls_rarity_idx on crate_pulls (rarity);

-- ============================================================================
-- Real accounts (replaces the old localStorage-only auth in AuthContext.tsx)
--
-- Unlike public_builds/crate_pulls above, these tables are scoped to
-- auth.uid() — a real signed-in user, not the shared anon key — so RLS here
-- is what actually keeps one user's data private from every other user,
-- not just from anonymous write/delete like the tables above.
-- ============================================================================

-- One row per authenticated user. Created automatically by the trigger below
-- when someone signs up — the client never inserts into this table directly.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  avatar text,
  preferred_resolution text not null default '1080p',
  preferred_preset text not null default 'high',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- No public/anon select policy: usernames aren't shown to other users
-- anywhere in the current UI (the public Gallery above uses its own
-- free-text creator_name, unrelated to accounts) — only add one if that
-- changes, and scope it to specific columns, not the whole row.

-- Auto-creates the profiles row when someone signs up. The client passes
-- the chosen username in auth.signUp's options.data, which lands in
-- raw_user_meta_data — see AuthContext.tsx. If the username is already
-- taken, this trigger throws (profiles.username is unique), which aborts
-- the signup transaction — the client checks for that case ahead of time
-- for a friendlier error, but this is the real backstop against a race.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- A user's saved builds — the actual cross-device value of having an
-- account. Replaces localStorage['specsmith-builds-<userId>'].
create table if not exists saved_builds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  notes text not null default '',
  build_state jsonb not null,
  shared_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table saved_builds enable row level security;

create policy "Users can view their own builds"
  on saved_builds for select
  using (auth.uid() = user_id);

create policy "Users can insert their own builds"
  on saved_builds for insert
  with check (
    auth.uid() = user_id
    and char_length(name) between 1 and 60
    and char_length(notes) <= 200
  );

create policy "Users can update their own builds"
  on saved_builds for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own builds"
  on saved_builds for delete
  using (auth.uid() = user_id);

create index if not exists saved_builds_user_id_idx on saved_builds (user_id);
create index if not exists saved_builds_created_at_idx on saved_builds (created_at desc);

-- Enforces the same 20-builds-per-user cap the old localStorage version had
-- (AuthContext.tsx's saveBuild used to check `current.length >= 20`
-- client-side only) — RLS controls *whose* rows are visible/writable, not
-- *how many* a user may have, so that cap needs its own check. Enforced
-- server-side too since a client-side-only check can be bypassed by anyone
-- calling the API directly with a valid session.
create or replace function enforce_saved_builds_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.saved_builds where user_id = new.user_id) >= 20 then
    raise exception 'saved_builds_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists before_saved_builds_insert on saved_builds;
create trigger before_saved_builds_insert
  before insert on saved_builds
  for each row execute function enforce_saved_builds_limit();

-- Keeps updated_at accurate on rename/share without the client having to
-- remember to set it on every update.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists before_saved_builds_update on saved_builds;
create trigger before_saved_builds_update
  before update on saved_builds
  for each row execute function set_updated_at();

-- Lets Signup.tsx check username availability while typing, without a
-- public select policy on profiles (which would expose every account's
-- username/avatar/prefs to anyone). Returns only a boolean — same
-- security-definer-narrow-RPC pattern as increment_build_views above.
create or replace function username_available(check_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(check_username)
  );
$$;
