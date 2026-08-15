import type { PendingDailyRecord } from "./offline";
import { supabase } from "./supabase";

export interface FarmListItem {
  role: "owner" | "manager" | "worker" | "viewer";
  permissions: {
    dashboard: boolean;
    flocks: boolean;
    team: boolean;
    evidence: boolean;
    reports: boolean;
  };
  farms: {
    id: string;
    name: string;
    location: string | null;
  };
  manager: {
    id: string | null;
    full_name: string;
  };
}

export interface Flock {
  id: string;
  farm_id: string;
  name: string;
  poultry_type: string;
  current_count: number;
}

export interface RemoteDailyRecord {
  id: string;
  farm_id: string;
  flock_id: string;
  record_date: string;
  mortality_count: number;
  culling_count: number;
  feed_consumed_kg: number | null;
  water_consumed_liters: number | null;
  eggs_collected: number | null;
  average_weight_grams: number | null;
  notes: string | null;
  idempotency_key: string;
  created_at: string;
}

export async function fetchAssignedFarms(): Promise<FarmListItem[]> {
  const { data, error } = await supabase.rpc("get_my_farm_assignments");
  if (error) throw new Error(`Could not load assigned farms: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    role: row.role as FarmListItem["role"],
    permissions: (row.permissions ?? {
      dashboard: false,
      flocks: false,
      team: false,
      evidence: false,
      reports: false
    }) as FarmListItem["permissions"],
    farms: {
      id: String(row.farm_id),
      name: String(row.farm_name),
      location: typeof row.farm_location === "string" ? row.farm_location : null
    },
    manager: {
      id: typeof row.manager_id === "string" ? row.manager_id : null,
      full_name: typeof row.manager_name === "string" ? row.manager_name : "Farm manager"
    }
  }));
}

export async function fetchFarmFlocks(farmId: string): Promise<Flock[]> {
  const { data, error } = await supabase
    .from("flocks")
    .select("id, farm_id, name, poultry_type, current_count")
    .eq("farm_id", farmId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("name");

  if (error) throw new Error(`Could not load farm flocks: ${error.message}`);
  return (data ?? []) as Flock[];
}

export async function fetchMyDailyRecords(farmId: string): Promise<RemoteDailyRecord[]> {
  const { data, error } = await supabase.from("daily_records")
    .select("id, farm_id, flock_id, record_date, mortality_count, culling_count, feed_consumed_kg, water_consumed_liters, eggs_collected, average_weight_grams, notes, idempotency_key, created_at")
    .eq("farm_id", farmId).is("deleted_at", null).order("record_date", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not load your reports: ${error.message}`);
  return (data ?? []) as RemoteDailyRecord[];
}

export async function pushDailyRecords(records: PendingDailyRecord[]) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Your Supabase session has expired. Sign in again.");

  const results: { idempotency_key: string; ok: boolean; error?: string }[] = [];
  for (const record of records) {
    const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id);
    const { error } = await supabase.from("daily_records").insert({
      ...(validUuid ? { id: record.id } : {}),
      farm_id: record.farm_id,
      flock_id: record.flock_id,
      record_date: record.record_date,
      mortality_count: record.mortality_count,
      culling_count: record.culling_count,
      feed_consumed_kg: record.feed_consumed_kg,
      water_consumed_liters: record.water_consumed_liters,
      eggs_collected: record.eggs_collected,
      average_weight_grams: record.average_weight_grams,
      notes: record.notes,
      idempotency_key: record.idempotency_key,
      created_by: userData.user.id
    });

    const duplicate = error?.code === "23505";
    results.push({
      idempotency_key: record.idempotency_key,
      ok: !error || duplicate,
      ...(error && !duplicate ? { error: error.message } : {})
    });
  }

  return results;
}
