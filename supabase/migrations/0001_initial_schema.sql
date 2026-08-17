create extension if not exists "pgcrypto";

create type public.farm_role as enum ('owner', 'manager', 'worker', 'viewer');
create type public.poultry_type as enum ('broiler', 'layer', 'breeder', 'duck', 'turkey', 'quail', 'other');
create type public.flock_status as enum ('active', 'sold', 'closed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  location text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.farm_members (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text,
  role public.farm_role not null,
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint farm_members_user_or_invite check (user_id is not null or invited_email is not null),
  constraint farm_members_unique_user unique (farm_id, user_id),
  constraint farm_members_unique_invite unique (farm_id, invited_email)
);

create table public.farm_units (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.flocks (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  farm_unit_id uuid references public.farm_units(id),
  name text not null check (char_length(name) between 2 and 120),
  poultry_type public.poultry_type not null,
  custom_poultry_type text,
  breed text,
  start_date date not null,
  initial_count integer not null check (initial_count > 0),
  current_count integer not null check (current_count >= 0),
  status public.flock_status not null default 'active',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.daily_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  flock_id uuid not null references public.flocks(id) on delete cascade,
  record_date date not null,
  mortality_count integer not null default 0 check (mortality_count >= 0),
  culling_count integer not null default 0 check (culling_count >= 0),
  feed_consumed_kg numeric(12, 3) check (feed_consumed_kg >= 0),
  water_consumed_liters numeric(12, 3) check (water_consumed_liters >= 0),
  eggs_collected integer check (eggs_collected >= 0),
  average_weight_grams numeric(12, 2) check (average_weight_grams >= 0),
  notes text,
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint daily_records_unique_idempotency unique (farm_id, idempotency_key)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid references public.farms(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_table text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger farms_touch_updated_at before update on public.farms for each row execute function public.touch_updated_at();
create trigger farm_members_touch_updated_at before update on public.farm_members for each row execute function public.touch_updated_at();
create trigger farm_units_touch_updated_at before update on public.farm_units for each row execute function public.touch_updated_at();
create trigger flocks_touch_updated_at before update on public.flocks for each row execute function public.touch_updated_at();
create trigger daily_records_touch_updated_at before update on public.daily_records for each row execute function public.touch_updated_at();

create or replace function public.is_farm_member(target_farm_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.farm_members fm
    where fm.farm_id = target_farm_id
      and fm.user_id = auth.uid()
      and fm.deleted_at is null
      and fm.accepted_at is not null
  );
$$;

create or replace function public.has_farm_role(target_farm_id uuid, allowed_roles public.farm_role[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.farm_members fm
    where fm.farm_id = target_farm_id
      and fm.user_id = auth.uid()
      and fm.role = any(allowed_roles)
      and fm.deleted_at is null
      and fm.accepted_at is not null
  );
$$;

alter table public.profiles enable row level security;
alter table public.farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.farm_units enable row level security;
alter table public.flocks enable row level security;
alter table public.daily_records enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles read own" on public.profiles for select using (id = auth.uid());
create policy "profiles update own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles insert own" on public.profiles for insert with check (id = auth.uid());

create policy "farms read members" on public.farms for select using (public.is_farm_member(id));
create policy "farms create authenticated" on public.farms for insert with check (created_by = auth.uid());
create policy "farms update owners managers" on public.farms for update using (public.has_farm_role(id, array['owner','manager']::public.farm_role[]));

create policy "members read farm" on public.farm_members for select using (public.is_farm_member(farm_id));
create policy "members manage owners" on public.farm_members for all using (public.has_farm_role(farm_id, array['owner']::public.farm_role[]));

create policy "units read farm" on public.farm_units for select using (public.is_farm_member(farm_id));
create policy "units manage owners managers" on public.farm_units for all using (public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[]));

create policy "flocks read farm" on public.flocks for select using (public.is_farm_member(farm_id));
create policy "flocks manage owners managers" on public.flocks for all using (public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[]));

create policy "daily records read farm" on public.daily_records for select using (public.is_farm_member(farm_id));
create policy "daily records create operators" on public.daily_records for insert with check (
  created_by = auth.uid()
  and public.has_farm_role(farm_id, array['owner','manager','worker']::public.farm_role[])
);
create policy "daily records update managers" on public.daily_records for update using (
  public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[])
);

create policy "audit logs read managers" on public.audit_logs for select using (
  public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[])
);

create index farm_members_user_id_idx on public.farm_members(user_id) where deleted_at is null;
create index flocks_farm_id_idx on public.flocks(farm_id) where deleted_at is null;
create index daily_records_farm_updated_idx on public.daily_records(farm_id, updated_at) where deleted_at is null;
create index daily_records_flock_date_idx on public.daily_records(flock_id, record_date) where deleted_at is null;
