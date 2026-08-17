create or replace function public.is_farm_member(target_farm_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.farm_members fm
    join public.farms f on f.id = fm.farm_id and f.deleted_at is null
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
    select 1 from public.farm_members fm
    join public.farms f on f.id = fm.farm_id and f.deleted_at is null
    where fm.farm_id = target_farm_id
      and fm.user_id = auth.uid()
      and fm.role = any(allowed_roles)
      and fm.deleted_at is null
      and fm.accepted_at is not null
  );
$$;

create or replace function public.protect_farm_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.farm_role;
begin
  if auth.uid() is null then return new; end if;

  select role into actor_role from public.farm_members
  where farm_id = coalesce(old.farm_id, new.farm_id)
    and user_id = auth.uid() and accepted_at is not null and deleted_at is null;

  if tg_op = 'UPDATE' and (
    new.farm_id is distinct from old.farm_id
    or new.user_id is distinct from old.user_id
    or new.invited_by is distinct from old.invited_by
    or old.role = 'owner' and actor_role <> 'owner'
    or new.role = 'owner' and actor_role <> 'owner'
  ) then
    raise exception 'Membership ownership and identity fields are protected' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.role = 'owner' and actor_role <> 'owner' then
    raise exception 'Only an owner can add another owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists farm_members_protect_privilege on public.farm_members;
create trigger farm_members_protect_privilege
  before insert or update on public.farm_members
  for each row execute function public.protect_farm_membership();

create or replace function public.protect_record_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.farm_id is distinct from old.farm_id
    or new.created_by is distinct from old.created_by
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Report provenance fields are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists daily_records_protect_provenance on public.daily_records;
create trigger daily_records_protect_provenance
  before update on public.daily_records
  for each row execute function public.protect_record_provenance();

create or replace function public.protect_evidence_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.farm_id is distinct from old.farm_id
    or new.flock_id is distinct from old.flock_id
    or new.captured_by is distinct from old.captured_by
    or new.storage_path is distinct from old.storage_path
    or new.latitude is distinct from old.latitude
    or new.longitude is distinct from old.longitude
    or new.accuracy_meters is distinct from old.accuracy_meters
    or new.device_captured_at is distinct from old.device_captured_at
    or new.server_received_at is distinct from old.server_received_at
    or new.timezone is distinct from old.timezone
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Evidence provenance fields are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists field_evidence_protect_provenance on public.field_evidence;
create trigger field_evidence_protect_provenance
  before update on public.field_evidence
  for each row execute function public.protect_evidence_provenance();

drop policy if exists "daily records read managers or own" on public.daily_records;
create policy "daily records read managers or current own" on public.daily_records
  for select using (
    deleted_at is null and (
      public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[])
      or (created_by = auth.uid() and public.is_farm_member(farm_id))
      or public.is_superadmin()
    )
  );

drop policy if exists "evidence read managers or own" on public.field_evidence;
create policy "evidence read managers or current own" on public.field_evidence
  for select using (
    deleted_at is null and (
      public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[])
      or (captured_by = auth.uid() and public.is_farm_member(farm_id))
      or public.is_superadmin()
    )
  );

alter table public.farm_members drop constraint if exists farm_members_permissions_shape;
alter table public.farm_members add constraint farm_members_permissions_shape check (
  jsonb_typeof(permissions) = 'object'
  and jsonb_typeof(permissions -> 'dashboard') = 'boolean'
  and jsonb_typeof(permissions -> 'flocks') = 'boolean'
  and jsonb_typeof(permissions -> 'team') = 'boolean'
  and jsonb_typeof(permissions -> 'evidence') = 'boolean'
  and jsonb_typeof(permissions -> 'reports') = 'boolean'
);

alter table public.field_evidence drop constraint if exists field_evidence_coordinate_range;
alter table public.field_evidence add constraint field_evidence_coordinate_range check (
  (latitude is null and longitude is null)
  or (latitude between -90 and 90 and longitude between -180 and 180)
);

alter table public.field_evidence drop constraint if exists field_evidence_sync_key_length;
alter table public.field_evidence add constraint field_evidence_sync_key_length check (char_length(idempotency_key) between 8 and 120);
