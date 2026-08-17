-- SPDX-FileCopyrightText: 2026 carlohustletv
-- SPDX-License-Identifier: GPL-3.0-only

-- Enforce the same canonical evidence path for direct inserts and RPC-based uploads.
create or replace function public.enforce_field_evidence_storage_path()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.storage_path <> new.farm_id::text || '/' || new.captured_by::text || '/' || new.id::text || '.jpg' then
    raise exception 'Evidence storage path is invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists field_evidence_enforce_storage_path on public.field_evidence;
create trigger field_evidence_enforce_storage_path
before insert or update of id, farm_id, captured_by, storage_path on public.field_evidence
for each row execute function public.enforce_field_evidence_storage_path();

create or replace function public.validate_flock_farm_unit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.farm_unit_id is not null and not exists (
    select 1 from public.farm_units u
    where u.id = new.farm_unit_id
      and u.farm_id = new.farm_id
      and u.deleted_at is null
  ) then
    raise exception 'Farm unit does not belong to this farm' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists flocks_validate_farm_unit on public.flocks;
create trigger flocks_validate_farm_unit
before insert or update of farm_id, farm_unit_id on public.flocks
for each row execute function public.validate_flock_farm_unit();

revoke execute on function public.is_farm_entitled(uuid) from public, anon, authenticated;
grant execute on function public.is_farm_entitled(uuid) to service_role;

drop policy if exists "evidence read managers or own" on public.field_evidence;
create policy "evidence read permitted personnel" on public.field_evidence
  for select using (
    public.is_superadmin()
    or (
      public.has_farm_module(farm_id, 'evidence')
      and (
        captured_by = auth.uid()
        or public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[])
      )
    )
  );

drop policy if exists "evidence storage read managers or own" on storage.objects;
create policy "evidence storage read permitted personnel" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'field-evidence'
    and exists (
      select 1 from public.field_evidence fe
      where fe.storage_path = storage.objects.name
        and fe.deleted_at is null
        and (
          public.is_superadmin()
          or (
            public.has_farm_module(fe.farm_id, 'evidence')
            and (
              fe.captured_by = auth.uid()
              or public.has_farm_role(fe.farm_id, array['owner','manager']::public.farm_role[])
            )
          )
        )
    )
  );

drop policy if exists "flocks read farm" on public.flocks;
create policy "flocks read permitted personnel" on public.flocks
  for select using (
    public.is_superadmin()
    or (public.has_farm_module(farm_id, 'flocks') and public.is_farm_member(farm_id))
  );

drop policy if exists "flocks manage owners managers" on public.flocks;
create policy "flocks manage permitted personnel" on public.flocks
  for all using (
    public.is_superadmin()
    or (public.has_farm_module(farm_id, 'flocks') and public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[]))
  ) with check (
    public.is_superadmin()
    or (public.has_farm_module(farm_id, 'flocks') and public.has_farm_role(farm_id, array['owner','manager']::public.farm_role[]))
  );
