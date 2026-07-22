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
  created_at timestamptz not null default now()
);

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
