alter table public.profiles
  add column if not exists system_role text not null default 'user'
  check (system_role in ('user', 'superadmin'));

create or replace function public.protect_profile_roles()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and (
    new.system_role is distinct from old.system_role
    or new.account_type is distinct from old.account_type
  ) then
    raise exception 'Account roles can only be changed by an administrator' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_roles on public.profiles;
create trigger profiles_protect_roles
  before update of system_role, account_type on public.profiles
  for each row execute function public.protect_profile_roles();

alter table public.farm_members
  add column if not exists permissions jsonb not null default '{"dashboard":true,"flocks":true,"team":false,"evidence":true,"reports":false}'::jsonb;

update public.farm_members
set permissions = case role
  when 'owner' then '{"dashboard":true,"flocks":true,"team":true,"evidence":true,"reports":true}'::jsonb
  when 'manager' then '{"dashboard":true,"flocks":true,"team":true,"evidence":true,"reports":true}'::jsonb
  when 'worker' then '{"dashboard":false,"flocks":true,"team":false,"evidence":true,"reports":false}'::jsonb
  else '{"dashboard":true,"flocks":true,"team":false,"evidence":true,"reports":true}'::jsonb
end;

create table public.field_evidence (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  flock_id uuid references public.flocks(id) on delete set null,
  captured_by uuid not null references auth.users(id),
  storage_path text not null unique,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters >= 0),
  device_captured_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  timezone text,
  notes text check (notes is null or char_length(notes) <= 1000),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint field_evidence_unique_sync unique (farm_id, idempotency_key)
);

create or replace function public.validate_field_evidence_flock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.flock_id is not null and not exists (
    select 1 from public.flocks f
    where f.id = new.flock_id
      and f.farm_id = new.farm_id
      and f.deleted_at is null
  ) then
    raise exception 'Flock does not belong to this farm' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger field_evidence_validate_flock
  before insert or update of farm_id, flock_id on public.field_evidence
  for each row execute function public.validate_field_evidence_flock();

create index field_evidence_farm_time_idx
  on public.field_evidence(farm_id, device_captured_at desc)
  where deleted_at is null;

alter table public.field_evidence enable row level security;

create or replace function public.is_superadmin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.system_role = 'superadmin'
  );
$$;

create or replace function public.has_farm_module(target_farm_id uuid, module_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_superadmin() or exists (
    select 1 from public.farm_members fm
    where fm.farm_id = target_farm_id
      and fm.user_id = auth.uid()
      and fm.accepted_at is not null
      and fm.deleted_at is null
      and coalesce((fm.permissions ->> module_name)::boolean, false)
  );
$$;

create or replace function public.storage_object_farm_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, storage
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create policy "evidence read farm managers" on public.field_evidence
  for select using (
    public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[])
    or public.is_superadmin()
  );

create policy "evidence create permitted personnel" on public.field_evidence
  for insert with check (
    captured_by = auth.uid()
    and public.has_farm_module(farm_id, 'evidence')
    and public.has_farm_role(farm_id, array['owner','manager','worker']::public.farm_role[])
  );

create policy "evidence update managers" on public.field_evidence
  for update using (
    public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[])
    or public.is_superadmin()
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('field-evidence', 'field-evidence', false, 10485760, array['image/jpeg','image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "evidence storage upload assigned farm" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'field-evidence'
    and public.has_farm_module(public.storage_object_farm_id(name), 'evidence')
    and public.has_farm_role(public.storage_object_farm_id(name), array['owner','manager','worker']::public.farm_role[])
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "evidence storage read farm managers" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'field-evidence'
    and (
      public.has_farm_role(public.storage_object_farm_id(name), array['owner','manager']::public.farm_role[])
      or public.is_superadmin()
    )
  );

create policy "evidence storage delete managers" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'field-evidence'
    and (
      public.has_farm_role(public.storage_object_farm_id(name), array['owner','manager']::public.farm_role[])
      or public.is_superadmin()
    )
  );

drop function if exists public.get_my_farm_assignments();
create function public.get_my_farm_assignments()
returns table (
  role public.farm_role,
  permissions jsonb,
  farm_id uuid,
  farm_name text,
  farm_location text,
  farm_notes text,
  farm_created_at timestamptz,
  manager_id uuid,
  manager_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    fm.role,
    fm.permissions,
    f.id,
    f.name,
    f.location,
    f.notes,
    f.created_at,
    f.created_by,
    coalesce(p.full_name, 'Farm manager')
  from public.farm_members fm
  join public.farms f on f.id = fm.farm_id and f.deleted_at is null
  left join public.profiles p on p.id = f.created_by
  where fm.user_id = auth.uid()
    and fm.accepted_at is not null
    and fm.deleted_at is null
  order by f.name;
$$;

grant execute on function public.get_my_farm_assignments() to authenticated;
