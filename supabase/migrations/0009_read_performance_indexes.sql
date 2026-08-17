create index if not exists daily_records_farm_record_date_idx
  on public.daily_records (farm_id, record_date desc)
  where deleted_at is null;

create index if not exists daily_records_farm_updated_id_idx
  on public.daily_records (farm_id, updated_at, id)
  where deleted_at is null;

create index if not exists audit_logs_farm_created_at_idx
  on public.audit_logs (farm_id, created_at desc);
