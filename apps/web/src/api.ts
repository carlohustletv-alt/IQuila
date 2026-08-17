import { apiUrl, supabase } from "./supabase";

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("You need to sign in first.");
  }

  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (options.body) headers.set("content-type", "application/json");

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Request failed");
  }

  if (body === null && response.status !== 204) throw new Error("API returned an empty response");
  return body as T;
}

export interface FarmListItem {
  role: "owner" | "manager" | "worker" | "viewer";
  permissions: ModulePermissions;
  farms: {
    id: string;
    name: string;
    location: string | null;
    notes: string | null;
    created_at: string;
  };
  manager: {
    id: string | null;
    full_name: string;
  };
}

export interface FarmMember {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  account_type: "manager" | "personnel";
  role: "owner" | "manager" | "worker" | "viewer";
  status: "active" | "invited";
  accepted_at: string | null;
  permissions?: ModulePermissions;
}

export interface ModulePermissions {
  dashboard: boolean;
  flocks: boolean;
  team: boolean;
  evidence: boolean;
  reports: boolean;
}

export interface FieldEvidence {
  id: string;
  farm_id: string;
  flock_id: string | null;
  captured_by: string;
  captured_by_name: string;
  signed_url: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  device_captured_at: string;
  server_received_at: string;
  timezone: string | null;
  notes: string | null;
  location_status?: {
    status?: string;
    source?: string;
    location_captured_at?: string | null;
    location_age_seconds?: number | null;
    accuracy_meters?: number | null;
  };
}

export interface DailyReport {
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
  created_by: string;
  created_at: string;
}

export interface AdminOverview {
  summary: { users: number; farms: number; memberships: number; flocks: number; daily_records: number; evidence: number; pending_manager_memberships: number };
  users: { id: string; full_name: string | null; email: string | null; account_type: string; membership_status: "active" | "pending" | "suspended"; system_role: "user" | "superadmin"; created_at: string }[];
  farms: { id: string; name: string; location: string | null; created_by: string; created_at: string }[];
  memberships: { id: string; farm_id: string; user_id: string | null; role: string; permissions: ModulePermissions; accepted_at: string | null }[];
  membership_audits: { id: string; actor_id: string | null; action: string; entity_table: string; entity_id: string | null; metadata: { previous_status?: string; new_status?: string; reason?: string }; created_at: string }[];
  analytics: {
    registrations: { date: string; count: number }[];
    field_activity: { date: string; count: number }[];
    membership_statuses: { status: "active" | "pending" | "suspended"; count: number }[];
    account_types: { account_type: "manager" | "personnel"; count: number }[];
    active_location_users: number;
  };
  locations: { user_id: string; full_name: string | null; email: string | null; farm_name: string; latitude: number; longitude: number; accuracy_meters: number | null; captured_at: string; received_at: string }[];
}

export interface Flock {
  id: string;
  name: string;
  poultry_type: string;
  breed: string | null;
  current_count: number;
  initial_count: number;
  status: string;
  start_date: string;
}

export interface DashboardData {
  farm: {
    id: string;
    name: string;
    location: string | null;
    notes: string | null;
    created_at: string;
  };
  summary: {
    members: number;
    accepted_members: number;
    units: number;
    flocks: number;
    active_flocks: number;
    total_birds: number;
    initial_birds: number;
    total_mortality: number;
    total_culls: number;
    mortality_rate: number;
    total_feed_kg: number;
    total_water_liters: number;
    total_eggs: number;
    daily_records: number;
  };
  poultry_mix: { type: string; count: number; birds: number }[];
  trends: { date: string; mortality: number; feed_kg: number; eggs: number; water_liters: number }[];
  recent_records: {
    id: string;
    flock_id: string;
    record_date: string;
    mortality_count: number;
    culling_count: number;
    feed_consumed_kg: number | null;
    water_consumed_liters: number | null;
    eggs_collected: number | null;
    average_weight_grams: number | null;
  }[];
  table_health: { table: string; rows: number }[];
  recent_audit_logs: { id: string; action: string; entity_table: string; created_at: string }[];
}
