alter table public.field_evidence
  add column if not exists location_status jsonb not null default '{}'::jsonb;

create or replace function public.finalize_field_evidence(
  evidence_id uuid,
  target_farm_id uuid,
  target_flock_id uuid,
  object_path text,
  captured_latitude double precision,
  captured_longitude double precision,
  captured_accuracy double precision,
  captured_at timestamptz,
  captured_timezone text,
  captured_notes text,
  sync_key text,
  captured_location_status jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.field_evidence;
begin
  if auth.uid() is null
    or not public.has_farm_module(target_farm_id, 'evidence')
    or not public.has_farm_role(target_farm_id, array['owner','manager','worker']::public.farm_role[])
  then
    raise exception 'Evidence upload is not allowed' using errcode = '42501';
  end if;

  if object_path <> target_farm_id::text || '/' || auth.uid()::text || '/' || evidence_id::text || '.jpg' then
    raise exception 'Evidence storage path is invalid' using errcode = '23514';
  end if;

  insert into public.field_evidence (
    id, farm_id, flock_id, captured_by, storage_path, latitude, longitude,
    accuracy_meters, device_captured_at, timezone, notes, idempotency_key, location_status
  ) values (
    evidence_id, target_farm_id, target_flock_id, auth.uid(), object_path,
    captured_latitude, captured_longitude, captured_accuracy, captured_at,
    captured_timezone, nullif(captured_notes, ''), sync_key, coalesce(captured_location_status, '{}'::jsonb)
  )
  on conflict (farm_id, idempotency_key) do nothing;

  select * into existing from public.field_evidence
  where farm_id = target_farm_id and idempotency_key = sync_key and deleted_at is null;

  if existing.id is null
    or existing.id <> evidence_id
    or existing.captured_by <> auth.uid()
    or existing.storage_path <> object_path
  then
    raise exception 'Evidence retry conflicts with an existing record' using errcode = '23505';
  end if;

  return existing.id;
end;
$$;

revoke execute on function public.finalize_field_evidence(uuid, uuid, uuid, text, double precision, double precision, double precision, timestamptz, text, text, text, jsonb) from public, anon;
grant execute on function public.finalize_field_evidence(uuid, uuid, uuid, text, double precision, double precision, double precision, timestamptz, text, text, text, jsonb) to authenticated;
