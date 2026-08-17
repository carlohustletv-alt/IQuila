alter table public.profiles
  add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is distinct from u.email;

create unique index if not exists profiles_email_lower_idx
  on public.profiles (lower(email))
  where email is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, account_type, membership_status)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    case when new.raw_user_meta_data ->> 'account_type' = 'manager' then 'manager' else 'personnel' end,
    case when new.raw_user_meta_data ->> 'account_type' = 'manager' then 'pending' else 'active' end
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create or replace function public.get_system_admin_analytics()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with registration_days as (
    select generate_series(current_date - 29, current_date, interval '1 day')::date as date
  ),
  registration_counts as (
    select d.date, count(p.id)::integer as count
    from registration_days d
    left join public.profiles p on p.created_at >= d.date and p.created_at < d.date + interval '1 day'
    group by d.date
    order by d.date
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'users', (select count(*) from public.profiles),
      'farms', (select count(*) from public.farms where deleted_at is null),
      'memberships', (select count(*) from public.farm_members where deleted_at is null),
      'flocks', (select count(*) from public.flocks where deleted_at is null),
      'daily_records', (select count(*) from public.daily_records where deleted_at is null),
      'evidence', (select count(*) from public.field_evidence where deleted_at is null),
      'pending_manager_memberships', (select count(*) from public.profiles where account_type = 'manager' and membership_status = 'pending')
    ),
    'registrations', (select coalesce(jsonb_agg(jsonb_build_object('date', date, 'count', count)), '[]'::jsonb) from registration_counts),
    'membership_statuses', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', count)), '[]'::jsonb) from (select status, count(p.id)::integer as count from unnest(array['active', 'pending', 'suspended']) status left join public.profiles p on p.membership_status = status group by status order by status) statuses),
    'account_types', (select coalesce(jsonb_agg(jsonb_build_object('account_type', account_type, 'count', count)), '[]'::jsonb) from (select t.account_type, count(p.id)::integer as count from unnest(array['manager', 'personnel']) as t(account_type) left join public.profiles p on p.account_type = t.account_type group by t.account_type order by t.account_type) account_types),
    'field_activity', (select coalesce(jsonb_agg(jsonb_build_object('date', date, 'count', count)), '[]'::jsonb) from (select d.date::date as date, count(e.id)::integer as count from generate_series(current_date - 13, current_date, interval '1 day') as d(date) left join public.field_evidence e on e.server_received_at >= d.date and e.server_received_at < d.date + interval '1 day' and e.deleted_at is null group by d.date order by d.date) activity)
  );
$$;

create or replace function public.get_recent_user_locations(max_rows integer default 250)
returns table (
  user_id uuid,
  full_name text,
  email text,
  farm_name text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  captured_at timestamptz,
  received_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select *
  from (
    select distinct on (e.captured_by)
      e.captured_by as user_id, p.full_name, p.email, f.name as farm_name, e.latitude, e.longitude,
      e.accuracy_meters, e.device_captured_at as captured_at, e.server_received_at as received_at
    from public.field_evidence e
    join public.profiles p on p.id = e.captured_by
    join public.farms f on f.id = e.farm_id and f.deleted_at is null
    where e.deleted_at is null and e.latitude is not null and e.longitude is not null
    order by e.captured_by, e.server_received_at desc
  ) latest
  order by received_at desc
  limit least(greatest(max_rows, 1), 250);
$$;

create index if not exists field_evidence_user_location_idx
  on public.field_evidence (captured_by, server_received_at desc)
  where deleted_at is null and latitude is not null and longitude is not null;

revoke execute on function public.get_system_admin_analytics() from public, anon, authenticated;
revoke execute on function public.get_recent_user_locations(integer) from public, anon, authenticated;
