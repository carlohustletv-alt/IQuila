alter table public.profiles
  add column if not exists account_type text not null default 'personnel'
  check (account_type in ('manager', 'personnel'));

update public.profiles p
set account_type = 'manager'
where exists (
  select 1 from public.farms f where f.created_by = p.id and f.deleted_at is null
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, account_type)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    case when new.raw_user_meta_data ->> 'account_type' = 'manager' then 'manager' else 'personnel' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_manager_account()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.account_type = 'manager'
  );
$$;

drop policy if exists "farms create authenticated" on public.farms;
create policy "farms create managers" on public.farms
  for insert with check (created_by = auth.uid() and public.is_manager_account());

drop policy if exists "members manage owners" on public.farm_members;
create policy "members manage owners managers" on public.farm_members
  for all
  using (public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[]))
  with check (public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[]));
