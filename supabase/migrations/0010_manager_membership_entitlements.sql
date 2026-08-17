alter table public.profiles
  add column if not exists membership_status text not null default 'active'
  check (membership_status in ('active', 'pending', 'suspended'));

-- Existing farms remain available while new manager registrations require approval.
update public.profiles
set membership_status = 'active'
where membership_status is null;

create or replace function public.protect_profile_roles()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null
    and not public.is_superadmin()
    and (
      new.system_role is distinct from old.system_role
      or new.account_type is distinct from old.account_type
      or new.membership_status is distinct from old.membership_status
    )
  then
    raise exception 'Account roles and membership can only be changed by an administrator' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, account_type, membership_status)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    case when new.raw_user_meta_data ->> 'account_type' = 'manager' then 'manager' else 'personnel' end,
    case when new.raw_user_meta_data ->> 'account_type' = 'manager' then 'pending' else 'active' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.is_manager_account()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.account_type = 'manager'
      and p.membership_status = 'active'
  );
$$;

create or replace function public.is_farm_entitled(target_farm_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.farms f
    join public.profiles owner_profile on owner_profile.id = f.created_by
    where f.id = target_farm_id
      and f.deleted_at is null
      and owner_profile.account_type = 'manager'
      and owner_profile.membership_status = 'active'
  );
$$;

create or replace function public.is_farm_member(target_farm_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_farm_entitled(target_farm_id) and exists (
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
  select public.is_farm_entitled(target_farm_id) and exists (
    select 1
    from public.farm_members fm
    where fm.farm_id = target_farm_id
      and fm.user_id = auth.uid()
      and fm.role = any(allowed_roles)
      and fm.deleted_at is null
      and fm.accepted_at is not null
  );
$$;

drop function if exists public.get_my_farm_assignments();

create function public.get_my_farm_assignments()
returns table (
  role public.farm_role,
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
    and public.is_farm_entitled(f.id)
  order by f.name;
$$;

create or replace function public.set_manager_membership_status(
  target_user_id uuid,
  next_status text,
  change_reason text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
  previous_status text;
begin
  if not public.is_superadmin() then
    raise exception 'Superadmin access required' using errcode = '42501';
  end if;
  if next_status not in ('active', 'suspended') then
    raise exception 'Membership status must be active or suspended' using errcode = '22023';
  end if;
  if char_length(trim(change_reason)) < 3 or char_length(change_reason) > 500 then
    raise exception 'Membership change reason must be between 3 and 500 characters' using errcode = '22023';
  end if;

  select * into target from public.profiles where id = target_user_id for update;
  if target.id is null or target.account_type <> 'manager' then
    raise exception 'Target must be a manager account' using errcode = '22023';
  end if;
  if target.id = auth.uid() and next_status = 'suspended' then
    raise exception 'You cannot suspend your own manager membership' using errcode = '42501';
  end if;

  previous_status := target.membership_status;

  update public.profiles
  set membership_status = next_status
  where id = target_user_id
  returning * into target;

  insert into public.audit_logs (farm_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    null,
    auth.uid(),
    case when next_status = 'active' then 'manager_membership_approved' else 'manager_membership_suspended' end,
    'profiles',
    target_user_id,
    jsonb_build_object('previous_status', previous_status, 'new_status', next_status, 'reason', trim(change_reason))
  );

  return target;
end;
$$;

revoke execute on function public.set_manager_membership_status(uuid, text, text) from public, anon;
grant execute on function public.set_manager_membership_status(uuid, text, text) to authenticated;
