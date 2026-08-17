create or replace function public.get_my_farm_assignments()
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
  order by f.name;
$$;

grant execute on function public.get_my_farm_assignments() to authenticated;

create or replace function public.validate_daily_record_flock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.flocks f
    where f.id = new.flock_id
      and f.farm_id = new.farm_id
      and f.deleted_at is null
  ) then
    raise exception 'Flock does not belong to this farm' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists daily_records_validate_flock on public.daily_records;
create trigger daily_records_validate_flock
  before insert or update of farm_id, flock_id on public.daily_records
  for each row execute function public.validate_daily_record_flock();
