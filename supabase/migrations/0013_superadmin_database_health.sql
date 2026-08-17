create or replace function public.get_system_database_health()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  with table_stats as (
    select
      s.relname as table_name,
      s.n_live_tup::bigint as estimated_rows,
      s.n_dead_tup::bigint as dead_rows,
      pg_total_relation_size(c.oid)::bigint as total_size_bytes,
      pg_indexes_size(c.oid)::bigint as index_size_bytes,
      s.last_autovacuum,
      s.last_autoanalyze,
      s.seq_scan::bigint as sequential_scans,
      s.idx_scan::bigint as index_scans,
      case when s.n_live_tup + s.n_dead_tup = 0 then 0
        else round(s.n_dead_tup::numeric / (s.n_live_tup + s.n_dead_tup), 4)
      end as dead_row_ratio
    from pg_stat_user_tables s
    join pg_class c on c.relname = s.relname and c.relnamespace = s.schemaname::regnamespace
    where s.schemaname = 'public'
      and s.relname = any(array['profiles', 'farms', 'farm_members', 'flocks', 'daily_records', 'field_evidence', 'audit_logs'])
  ), database_stats as (
    select blks_read, blks_hit
    from pg_stat_database
    where datname = current_database()
  )
  select jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database())::bigint,
    'active_connections', (select count(*)::integer from pg_stat_activity where datname = current_database() and state = 'active'),
    'total_connections', (select count(*)::integer from pg_stat_activity where datname = current_database()),
    'max_connections', current_setting('max_connections')::integer,
    'cache_hit_ratio', coalesce((select round(blks_hit::numeric / nullif(blks_hit + blks_read, 0), 4) from database_stats), 1),
    'tables', coalesce((select jsonb_agg(jsonb_build_object(
      'table', table_name,
      'estimated_rows', estimated_rows,
      'dead_rows', dead_rows,
      'dead_row_ratio', dead_row_ratio,
      'total_size_bytes', total_size_bytes,
      'index_size_bytes', index_size_bytes,
      'last_autovacuum', last_autovacuum,
      'last_autoanalyze', last_autoanalyze,
      'sequential_scans', sequential_scans,
      'index_scans', index_scans,
      'status', case when dead_row_ratio >= 0.2 then 'maintenance_due' when estimated_rows >= 1000 and last_autoanalyze is null then 'observe' else 'healthy' end
    ) order by total_size_bytes desc) from table_stats), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_system_database_health() from public, anon, authenticated;
