export type SyncOperation = "insert" | "update" | "delete";
export type SyncTable = "daily_records";

export interface SyncChange<TPayload = Record<string, unknown>> {
  table: SyncTable;
  operation: SyncOperation;
  payload: TPayload;
  idempotency_key: string;
}

export interface SyncPushRequest {
  farm_id: string;
  device_id: string;
  changes: SyncChange[];
}

export interface SyncPullResponse {
  server_time: string;
  daily_records: Record<string, unknown>[];
}
