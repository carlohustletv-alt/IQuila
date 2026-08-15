import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const recordsKeyPrefix = "flockiq:daily-records";
const MAX_SYNCED_RECORDS = 100;
let recordOperation: Promise<unknown> = Promise.resolve();

function withRecordLock<T>(operation: () => Promise<T>) {
  const next = recordOperation.then(operation, operation);
  recordOperation = next.then(() => undefined, () => undefined);
  return next;
}

export interface PendingDailyRecord {
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
  sync_status: "pending" | "synced" | "failed";
  created_at: string;
}

async function recordsKey() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user.id) throw new Error("Sign in before accessing offline reports");
  return `${recordsKeyPrefix}:${data.session.user.id}`;
}

async function readRecords() {
  const raw = await AsyncStorage.getItem(await recordsKey());
  return raw ? (JSON.parse(raw) as PendingDailyRecord[]) : [];
}

async function writeRecords(records: PendingDailyRecord[]) {
  await AsyncStorage.setItem(await recordsKey(), JSON.stringify(records));
}

export async function initializeOfflineStore() {
  return withRecordLock(async () => {
    const records = await readRecords();
    await writeRecords(records);
  });
}

export async function savePendingDailyRecord(record: Omit<PendingDailyRecord, "sync_status" | "created_at">) {
  return withRecordLock(async () => {
    const records = await readRecords();
    const nextRecord: PendingDailyRecord = { ...record, sync_status: "pending", created_at: new Date().toISOString() };
    const existingIndex = records.findIndex((item) => item.idempotency_key === record.idempotency_key);
    if (existingIndex >= 0) records[existingIndex] = nextRecord;
    else records.push(nextRecord);
    await writeRecords(records);
  });
}

export async function getPendingDailyRecords() {
  return withRecordLock(async () => (await readRecords())
    .filter((record) => record.sync_status === "pending" || record.sync_status === "failed")
    .sort((a, b) => a.created_at.localeCompare(b.created_at)));
}

export async function getDailyRecordsForFarm(farmId: string) {
  return withRecordLock(async () => (await readRecords())
    .filter((record) => record.farm_id === farmId)
    .sort((a, b) => b.record_date.localeCompare(a.record_date) || b.created_at.localeCompare(a.created_at)));
}

export async function applyDailyRecordSyncResults(results: { idempotency_key: string; ok: boolean }[]) {
  return withRecordLock(async () => {
    const statuses = new Map(results.map((result) => [result.idempotency_key, result.ok ? "synced" as const : "failed" as const]));
    const updated = (await readRecords()).map((record) => {
      const syncStatus = statuses.get(record.idempotency_key);
      return syncStatus ? { ...record, sync_status: syncStatus } : record;
    });
    const active = updated.filter((record) => record.sync_status !== "synced");
    const synced = updated.filter((record) => record.sync_status === "synced")
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, MAX_SYNCED_RECORDS);
    await writeRecords([...active, ...synced]);
    return results.filter((result) => !result.ok).length;
  });
}
