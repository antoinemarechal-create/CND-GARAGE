-- C.N.D. 4 DINANT GARAGE — SUPABASE
-- Supabase > SQL Editor > New query > coller puis Run

create table if not exists public.clients (
  id text primary key, payload jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.vehicles (
  id text primary key, payload jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.staff (
  id text primary key, payload jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.interventions (
  id text primary key, payload jsonb not null, updated_at timestamptz not null default now()
);

alter table public.clients enable row level security;
alter table public.vehicles enable row level security;
alter table public.staff enable row level security;
alter table public.interventions enable row level security;

drop policy if exists authenticated_all_clients on public.clients;
create policy authenticated_all_clients on public.clients for all to authenticated using (true) with check (true);
drop policy if exists authenticated_all_vehicles on public.vehicles;
create policy authenticated_all_vehicles on public.vehicles for all to authenticated using (true) with check (true);
drop policy if exists authenticated_all_staff on public.staff;
create policy authenticated_all_staff on public.staff for all to authenticated using (true) with check (true);
drop policy if exists authenticated_all_interventions on public.interventions;
create policy authenticated_all_interventions on public.interventions for all to authenticated using (true) with check (true);

create index if not exists idx_clients_updated_at on public.clients(updated_at);
create index if not exists idx_vehicles_updated_at on public.vehicles(updated_at);
create index if not exists idx_staff_updated_at on public.staff(updated_at);
create index if not exists idx_interventions_updated_at on public.interventions(updated_at);
