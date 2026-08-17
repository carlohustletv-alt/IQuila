-- Audit operational writes at the database boundary so web, mobile, RPC, and API writes are all covered.
create or replace function public.audit_operational_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb := to_jsonb(new);
  target_farm_id uuid;
  target_actor_id uuid;
begin
  target_farm_id := coalesce(
    nullif(payload ->> 'farm_id', '')::uuid,
    case when tg_table_name = 'farms' then nullif(payload ->> 'id', '')::uuid end
  );
  target_actor_id := coalesce(
    auth.uid(),
    nullif(payload ->> 'created_by', '')::uuid,
    nullif(payload ->> 'captured_by', '')::uuid,
    nullif(payload ->> 'invited_by', '')::uuid
  );

  insert into public.audit_logs (farm_id, actor_id, action, entity_table, entity_id, metadata)
  values (
    target_farm_id,
    target_actor_id,
    lower(tg_table_name) || '.' || lower(tg_op),
    tg_table_name,
    nullif(payload ->> 'id', '')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'database_trigger',
      'name', payload ->> 'name',
      'role', payload ->> 'role',
      'status', payload ->> 'status',
      'record_date', payload ->> 'record_date'
    ))
  );
  return new;
end;
$$;

revoke execute on function public.audit_operational_write() from public, anon, authenticated;

create or replace trigger farms_audit_operational_write
after insert or update on public.farms
for each row execute function public.audit_operational_write();

create or replace trigger farm_members_audit_operational_write
after insert or update on public.farm_members
for each row execute function public.audit_operational_write();

create or replace trigger flocks_audit_operational_write
after insert or update on public.flocks
for each row execute function public.audit_operational_write();

create or replace trigger daily_records_audit_operational_write
after insert or update on public.daily_records
for each row execute function public.audit_operational_write();

create or replace trigger field_evidence_audit_operational_write
after insert or update on public.field_evidence
for each row execute function public.audit_operational_write();

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
