-- The shared lap board for the 3D world (world/game/Leaderboard.js).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Visitors can only read the board and add a lap; nobody can change or delete one from the site.

create table if not exists public.laps (
  id         bigint generated always as identity primary key,
  name       text        not null check (char_length(name) between 1 and 16 and name ~ '^[A-Za-z0-9 ._''-]+$'),
  time       real        not null check (time between 15 and 900),
  created_at timestamptz not null default now()
);

create index if not exists laps_time on public.laps (time);

alter table public.laps enable row level security;

drop policy if exists "read the board" on public.laps;
create policy "read the board" on public.laps for select to anon using (true);

drop policy if exists "add a lap" on public.laps;
create policy "add a lap" on public.laps for insert to anon with check (true);

grant select, insert on public.laps to anon;
