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
