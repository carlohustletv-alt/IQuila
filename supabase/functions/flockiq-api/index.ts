import { createClient, type User } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

type FarmRole = "owner" | "manager" | "worker" | "viewer";
type Variables = { user: User };
type RateBucket = { startedAt: number; count: number };

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !publishableKey || !serviceRoleKey) throw new Error("Supabase function environment is incomplete");

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const allowedOrigins = (Deno.env.get("WEB_ALLOWED_ORIGINS") ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
const rateBuckets = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60_000;
const MAX_REQUEST_BYTES = 65_536;

const uuid = z.string().uuid();
const createFarmSchema = z.object({ name: z.string().trim().min(2).max(120), location: z.string().trim().max(200).optional(), notes: z.string().trim().max(1000).optional() });
const createFlockSchema = z.object({
  farm_unit_id: uuid.optional(), name: z.string().trim().min(2).max(120),
  poultry_type: z.enum(["broiler", "layer", "breeder", "duck", "turkey", "quail", "other"]),
  custom_poultry_type: z.string().trim().max(80).optional(), breed: z.string().trim().max(120).optional(),
  start_date: z.iso.date(), initial_count: z.number().int().positive(), status: z.enum(["active", "sold", "closed"]).default("active")
});
const inviteSchema = z.object({ email: z.email().toLowerCase(), role: z.enum(["manager", "worker", "viewer"]) });
const permissionsSchema = z.object({ dashboard: z.boolean(), flocks: z.boolean(), team: z.boolean(), evidence: z.boolean(), reports: z.boolean() });
const systemRoleSchema = z.object({ system_role: z.enum(["user", "superadmin"]) });
const membershipUpdateSchema = z.object({ membership_status: z.enum(["active", "suspended"]), reason: z.string().trim().min(3).max(500) });
const dailyRecordSchema = z.object({
  id: uuid.optional(), flock_id: uuid, record_date: z.iso.date(),
  mortality_count: z.number().int().min(0).default(0), culling_count: z.number().int().min(0).default(0),
  feed_consumed_kg: z.number().min(0).nullable().optional(), water_consumed_liters: z.number().min(0).nullable().optional(),
  eggs_collected: z.number().int().min(0).nullable().optional(), average_weight_grams: z.number().min(0).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(), idempotency_key: z.string().trim().min(8).max(120)
});

const app = new Hono<{ Variables: Variables }>().basePath("/flockiq-api");

function apiError(c: Context, status: 400 | 401 | 403 | 409 | 429 | 500, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

function allowRequest(userId: string, method: string, path: string) {
  const limit = method === "GET" ? 120 : 60;
  const key = `${userId}:${method}:${path}`;
  const now = Date.now();
  if (rateBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(bucketKey);
    }
  }
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function bearer(header?: string) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

async function farmRole(farmId: string, userId: string): Promise<FarmRole | null> {
  const [membership, entitlement] = await Promise.all([
    admin.from("farm_members").select("role, farms!inner(id)").eq("farm_id", farmId).eq("user_id", userId)
      .is("deleted_at", null).not("accepted_at", "is", null).is("farms.deleted_at", null).maybeSingle(),
    admin.rpc("is_farm_entitled", { target_farm_id: farmId })
  ]);
  if (membership.error || entitlement.error) throw membership.error ?? entitlement.error;
  return entitlement.data ? (membership.data?.role as FarmRole | undefined) ?? null : null;
}

async function superadmin(userId: string) {
  const { data, error } = await admin.from("profiles").select("system_role").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.system_role === "superadmin";
}

function can(role: FarmRole | null, action: "read" | "manage" | "reports") {
  if (!role) return false;
  if (action === "read") return true;
  if (action === "reports") return role === "owner" || role === "manager" || role === "viewer";
  return role === "owner" || role === "manager";
}

app.use("*", cors({
  origin: (origin) => allowedOrigins.includes(origin.replace(/\/$/, "")) ? origin : undefined,
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "apikey", "x-client-info"], maxAge: 86400
}));

app.get("/health", (c) => c.json({ ok: true, runtime: "supabase-edge" }));

app.use("/api/*", async (c, next) => {
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return apiError(c, 400, "request_too_large", "Request body exceeds the 64 KB limit");
  const token = bearer(c.req.header("authorization"));
  if (!token) return apiError(c, 401, "unauthorized", "Missing bearer token");
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return apiError(c, 401, "unauthorized", "Invalid bearer token");
  if (!allowRequest(data.user.id, c.req.method, c.req.path)) {
    c.header("retry-after", "60");
    return apiError(c, 429, "rate_limited", "Too many requests. Try again in one minute.");
  }
  c.set("user", data.user);
  await next();
});

app.get("/api/auth/me", async (c) => {
  const user = c.get("user");
  const { data, error } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) return apiError(c, 500, "profile_read_failed", "Could not load profile");
  return c.json({ user: { id: user.id, email: user.email }, profile: data });
});

app.get("/api/admin/overview", async (c) => {
  const user = c.get("user");
  if (!(await superadmin(user.id))) return apiError(c, 403, "superadmin_required", "Superadmin access required");
  const [analytics, locations, entitlementAudits, systemActivity] = await Promise.all([
    admin.rpc("get_system_admin_analytics"),
    admin.rpc("get_recent_user_locations", { max_rows: 250 }),
    admin.from("audit_logs").select("id, actor_id, action, entity_table, entity_id, metadata, created_at").is("farm_id", null).in("action", ["manager_membership_approved", "manager_membership_suspended"]).order("created_at", { ascending: false }).limit(30),
    admin.from("audit_logs").select("id, farm_id, actor_id, action, entity_table, entity_id, metadata, created_at").order("created_at", { ascending: false }).limit(100)
  ]);
  const failure = [analytics, locations, entitlementAudits, systemActivity].find((result) => result.error)?.error;
  if (failure) return apiError(c, 500, "admin_overview_failed", "Could not load system overview");
  const actorIds = [...new Set((systemActivity.data ?? []).flatMap((entry) => entry.actor_id ? [entry.actor_id] : []))];
  const farmIds = [...new Set((systemActivity.data ?? []).flatMap((entry) => entry.farm_id ? [entry.farm_id] : []))];
  const [actors, farms] = await Promise.all([
    actorIds.length ? admin.from("profiles").select("id, full_name, email").in("id", actorIds) : { data: [], error: null },
    farmIds.length ? admin.from("farms").select("id, name").in("id", farmIds) : { data: [], error: null }
  ]);
  if (actors.error || farms.error) return apiError(c, 500, "admin_activity_details_failed", "Could not load activity details");
  const actorById = new Map((actors.data ?? []).map((profile) => [profile.id, profile]));
  const farmById = new Map((farms.data ?? []).map((farm) => [farm.id, farm]));
  const analyticsData = analytics.data as { summary: Record<string, number>; registrations: unknown[]; field_activity: unknown[]; membership_statuses: unknown[]; account_types: unknown[] };
  return c.json({
    summary: analyticsData.summary,
    membership_audits: entitlementAudits.data ?? [],
    analytics: {
      registrations: analyticsData.registrations, field_activity: analyticsData.field_activity,
      membership_statuses: analyticsData.membership_statuses, account_types: analyticsData.account_types,
      active_location_users: locations.data?.length ?? 0
    },
    locations: locations.data ?? [],
    activity: (systemActivity.data ?? []).map((entry) => {
      const actor = entry.actor_id ? actorById.get(entry.actor_id) : null;
      return {
        ...entry,
        actor: actor ? { id: entry.actor_id, full_name: actor.full_name, email: actor.email } : null,
        farm_name: entry.farm_id ? farmById.get(entry.farm_id)?.name ?? "Deleted farm" : "System"
      };
    })
  });
});

app.get("/api/admin/users", async (c) => {
  const user = c.get("user");
  if (!(await superadmin(user.id))) return apiError(c, 403, "superadmin_required", "Superadmin access required");
  const query = z.object({ page: z.coerce.number().int().min(0).max(10_000).default(0), search: z.string().trim().max(100).default("") }).parse(c.req.query());
  const pageSize = 50;
  const search = query.search.replace(/[%_,()]/g, "");
  let request = admin.from("profiles").select("id, full_name, email, account_type, membership_status, system_role, created_at", { count: "estimated" }).order("created_at", { ascending: false });
  if (search) request = request.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  const { data, error, count } = await request.range(query.page * pageSize, query.page * pageSize + pageSize - 1);
  if (error) return apiError(c, 500, "admin_users_failed", "Could not load accounts");
  return c.json({ users: data ?? [], page: query.page, page_size: pageSize, total: count ?? 0 });
});

app.get("/api/admin/database-health", async (c) => {
  const user = c.get("user");
  if (!(await superadmin(user.id))) return apiError(c, 403, "superadmin_required", "Superadmin access required");
  const { data, error } = await admin.rpc("get_system_database_health");
  if (error) return apiError(c, 500, "database_health_failed", "Could not load database health");
  return c.json(data);
});

app.patch("/api/admin/users/:userId/membership-status", async (c) => {
  const actor = c.get("user");
  if (!(await superadmin(actor.id))) return apiError(c, 403, "superadmin_required", "Superadmin access required");
  const userId = uuid.parse(c.req.param("userId"));
  const body = membershipUpdateSchema.parse(await c.req.json());
  const token = bearer(c.req.header("authorization"));
  const caller = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await caller.rpc("set_manager_membership_status", { target_user_id: userId, next_status: body.membership_status, change_reason: body.reason });
  if (error) return apiError(c, 400, "membership_update_failed", error.message);
  return c.json({ profile: data });
});

app.patch("/api/admin/users/:userId/system-role", async (c) => {
  const actor = c.get("user");
  if (!(await superadmin(actor.id))) return apiError(c, 403, "superadmin_required", "Superadmin access required");
  const userId = uuid.parse(c.req.param("userId"));
  const body = systemRoleSchema.parse(await c.req.json());
  if (userId === actor.id && body.system_role !== "superadmin") return apiError(c, 400, "self_demotion_blocked", "You cannot remove your own superadmin access");
  const { data, error } = await admin.from("profiles").update(body).eq("id", userId).select("*").single();
  if (error) return apiError(c, 400, "system_role_update_failed", "Could not update system role");
  return c.json({ profile: data });
});

app.get("/api/farms", async (c) => {
  const user = c.get("user");
  const { data, error } = await admin.from("farm_members").select("role, permissions, farms(*)").eq("user_id", user.id)
    .is("deleted_at", null).not("accepted_at", "is", null);
  if (error) return apiError(c, 500, "farms_read_failed", "Could not load farms");
  const creatorIds = (data ?? []).flatMap((item) => {
    const farm = Array.isArray(item.farms) ? item.farms[0] : item.farms;
    return farm?.created_by ? [farm.created_by] : [];
  });
  const managers = creatorIds.length ? await admin.from("profiles").select("id, full_name, membership_status").in("id", creatorIds) : { data: [], error: null };
  if (managers.error) return apiError(c, 500, "managers_read_failed", "Could not load farm managers");
  const managerById = new Map((managers.data ?? []).map((manager) => [manager.id, manager]));
  return c.json({ farms: (data ?? []).flatMap((item) => {
    const farm = Array.isArray(item.farms) ? item.farms[0] : item.farms;
    const manager = farm?.created_by ? managerById.get(farm.created_by) : null;
    return manager?.membership_status === "active" ? [{ ...item, manager: { id: farm?.created_by ?? null, full_name: manager.full_name ?? "Farm manager" } }] : [];
  }) });
});

app.post("/api/farms", async (c) => {
  const user = c.get("user");
  const body = createFarmSchema.parse(await c.req.json());
  const profile = await admin.from("profiles").select("account_type, membership_status").eq("id", user.id).maybeSingle();
  if (profile.error) return apiError(c, 500, "profile_read_failed", "Could not load profile");
  if (profile.data?.account_type !== "manager" || profile.data.membership_status !== "active") return apiError(c, 403, "membership_required", "An active manager membership is required to register farms");
  const farmResult = await admin.from("farms").insert({ ...body, created_by: user.id }).select("*").single();
  if (farmResult.error) return apiError(c, 500, "farm_create_failed", "Could not create farm");
  const memberResult = await admin.from("farm_members").insert({ farm_id: farmResult.data.id, user_id: user.id, role: "owner", invited_by: user.id, accepted_at: new Date().toISOString() });
  if (memberResult.error) return apiError(c, 500, "farm_owner_create_failed", "Could not assign farm owner");
  return c.json({ farm: farmResult.data }, 201);
});

app.post("/api/farms/:farmId/members", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  if (!can(await farmRole(farmId, user.id), "manage")) return apiError(c, 403, "forbidden", "You cannot manage members for this farm");
  const body = inviteSchema.parse(await c.req.json());
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) return apiError(c, 500, "users_read_failed", "Could not search registered users");
  const registered = users.data.users.find((item) => item.email?.toLowerCase() === body.email);
  const { data, error } = await admin.from("farm_members").upsert({
    farm_id: farmId, user_id: registered?.id ?? null, invited_email: registered ? null : body.email,
    role: body.role, invited_by: user.id, accepted_at: registered ? new Date().toISOString() : null, deleted_at: null
  }, registered ? { onConflict: "farm_id,user_id" } : { onConflict: "farm_id,invited_email" }).select("*").single();
  if (error) return apiError(c, 500, "member_invite_failed", "Could not assign personnel");
  return c.json({ member: data }, 201);
});

app.get("/api/farms/:farmId/members", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  if (!can(await farmRole(farmId, user.id), "manage")) return apiError(c, 403, "forbidden", "Only farm managers can view this team");
  const members = await admin.from("farm_members").select("id, user_id, invited_email, role, permissions, accepted_at, created_at").eq("farm_id", farmId).is("deleted_at", null).order("created_at");
  if (members.error) return apiError(c, 500, "members_read_failed", "Could not load farm members");
  const userIds = members.data.flatMap((member) => member.user_id ? [member.user_id] : []);
  const profiles = userIds.length ? await admin.from("profiles").select("id, full_name, account_type").in("id", userIds) : { data: [], error: null };
  const authUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (profiles.error || authUsers.error) return apiError(c, 500, "member_profiles_failed", "Could not load member profiles");
  const profileById = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  const emailById = new Map(authUsers.data.users.map((account) => [account.id, account.email]));
  return c.json({ members: members.data.map((member) => ({ ...member,
    email: member.user_id ? emailById.get(member.user_id) ?? null : member.invited_email,
    full_name: member.user_id ? profileById.get(member.user_id)?.full_name ?? null : null,
    account_type: member.user_id ? profileById.get(member.user_id)?.account_type ?? "personnel" : "personnel",
    status: member.accepted_at ? "active" : "invited"
  })) });
});

app.patch("/api/farms/:farmId/members/:memberId/permissions", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  const memberId = uuid.parse(c.req.param("memberId"));
  if (!can(await farmRole(farmId, user.id), "manage") && !(await superadmin(user.id))) return apiError(c, 403, "forbidden", "You cannot manage this member's views");
  const permissions = permissionsSchema.parse(await c.req.json());
  const { data, error } = await admin.from("farm_members").update({ permissions }).eq("id", memberId).eq("farm_id", farmId).neq("role", "owner").select("*").single();
  if (error) return apiError(c, 400, "permissions_update_failed", "Could not update permissions");
  return c.json({ member: data });
});

app.delete("/api/farms/:farmId/members/:memberId", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  const memberId = uuid.parse(c.req.param("memberId"));
  if (!can(await farmRole(farmId, user.id), "manage")) return apiError(c, 403, "forbidden", "You cannot manage this farm team");
  const { error } = await admin.from("farm_members").update({ deleted_at: new Date().toISOString() }).eq("id", memberId).eq("farm_id", farmId).neq("role", "owner");
  if (error) return apiError(c, 400, "member_remove_failed", "Could not remove personnel");
  return c.body(null, 204);
});

app.get("/api/farms/:farmId/evidence", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  const role = await farmRole(farmId, user.id);
  if (!role) return apiError(c, 403, "forbidden", "You cannot view evidence for this farm");
  let query = admin.from("field_evidence").select("id, farm_id, flock_id, captured_by, storage_path, latitude, longitude, accuracy_meters, device_captured_at, server_received_at, timezone, notes, location_status")
    .eq("farm_id", farmId).is("deleted_at", null).order("device_captured_at", { ascending: false }).limit(500);
  if (!can(role, "manage")) query = query.eq("captured_by", user.id);
  const result = await query;
  if (result.error) return apiError(c, 500, "evidence_read_failed", "Could not load field evidence");
  const paths = result.data.map((item) => item.storage_path);
  const signed = paths.length ? await admin.storage.from("field-evidence").createSignedUrls(paths, 3600) : { data: [], error: null };
  const profiles = result.data.length ? await admin.from("profiles").select("id, full_name").in("id", [...new Set(result.data.map((item) => item.captured_by))]) : { data: [], error: null };
  if (signed.error || profiles.error) return apiError(c, 500, "evidence_details_failed", "Could not prepare field evidence");
  const urls = new Map((signed.data ?? []).map((item, index) => [paths[index], item.signedUrl]));
  const names = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.full_name]));
  return c.json({ evidence: result.data.map((item) => ({ ...item, signed_url: urls.get(item.storage_path) ?? null, captured_by_name: names.get(item.captured_by) ?? "Personnel" })) });
});

app.get("/api/farms/:farmId/daily-records", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  const role = await farmRole(farmId, user.id);
  if (!role) return apiError(c, 403, "forbidden", "You cannot view reports for this farm");
  let query = admin.from("daily_records")
    .select("id, farm_id, flock_id, record_date, mortality_count, culling_count, feed_consumed_kg, water_consumed_liters, eggs_collected, average_weight_grams, notes, idempotency_key, created_by, created_at, updated_at")
    .eq("farm_id", farmId).is("deleted_at", null).order("record_date", { ascending: false }).limit(500);
  if (!can(role, "manage")) query = query.eq("created_by", user.id);
  const { data, error } = await query;
  if (error) return apiError(c, 500, "daily_records_read_failed", "Could not load reports");
  return c.json({ daily_records: data });
});

app.post("/api/farms/:farmId/daily-records", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  const role = await farmRole(farmId, user.id);
  if (!role || role === "viewer") return apiError(c, 403, "forbidden", "You cannot create reports for this farm");
  const body = dailyRecordSchema.parse(await c.req.json());
  const flock = await admin.from("flocks").select("id").eq("id", body.flock_id).eq("farm_id", farmId).is("deleted_at", null).maybeSingle();
  if (flock.error || !flock.data) return apiError(c, 400, "invalid_flock", "Flock does not belong to this farm");
  const inserted = await admin.from("daily_records").insert({ ...body, farm_id: farmId, created_by: user.id }).select("*").single();
  if (!inserted.error) return c.json({ daily_record: inserted.data }, 201);
  if (inserted.error.code !== "23505") return apiError(c, 500, "daily_record_create_failed", "Could not create report");
  const existing = await admin.from("daily_records").select("*").eq("farm_id", farmId).eq("idempotency_key", body.idempotency_key).eq("created_by", user.id).maybeSingle();
  if (existing.error || !existing.data) return apiError(c, 409, "idempotency_conflict", "This sync key belongs to another report");
  return c.json({ daily_record: existing.data });
});

app.get("/api/farms/:farmId/flocks", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  if (!can(await farmRole(farmId, user.id), "read")) return apiError(c, 403, "forbidden", "You cannot view this farm");
  const { data, error } = await admin.from("flocks").select("*").eq("farm_id", farmId).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) return apiError(c, 500, "flocks_read_failed", "Could not load flocks");
  return c.json({ flocks: data });
});

app.post("/api/farms/:farmId/flocks", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  if (!can(await farmRole(farmId, user.id), "manage")) return apiError(c, 403, "forbidden", "You cannot manage flocks for this farm");
  const body = createFlockSchema.parse(await c.req.json());
  const { data, error } = await admin.from("flocks").insert({ ...body, farm_id: farmId, current_count: body.initial_count, created_by: user.id }).select("*").single();
  if (error) return apiError(c, 500, "flock_create_failed", "Could not create flock");
  return c.json({ flock: data }, 201);
});

app.get("/api/farms/:farmId/dashboard", async (c) => {
  const user = c.get("user");
  const farmId = uuid.parse(c.req.param("farmId"));
  if (!can(await farmRole(farmId, user.id), "manage")) return apiError(c, 403, "forbidden", "Only owners and managers can view farm-wide analytics");
  const [farm, members, units, flocksResult, recordsResult, audit] = await Promise.all([
    admin.from("farms").select("id, name, location, notes, created_at").eq("id", farmId).single(),
    admin.from("farm_members").select("id, role, accepted_at, created_at").eq("farm_id", farmId).is("deleted_at", null),
    admin.from("farm_units").select("id, name, created_at").eq("farm_id", farmId).is("deleted_at", null),
    admin.from("flocks").select("id, name, poultry_type, current_count, initial_count, status, start_date, created_at").eq("farm_id", farmId).is("deleted_at", null),
    admin.from("daily_records").select("id, flock_id, record_date, mortality_count, culling_count, feed_consumed_kg, water_consumed_liters, eggs_collected, average_weight_grams, created_at").eq("farm_id", farmId).is("deleted_at", null).order("record_date"),
    admin.from("audit_logs").select("id, action, entity_table, created_at").eq("farm_id", farmId).order("created_at", { ascending: false }).limit(8)
  ]);
  if ([farm, members, units, flocksResult, recordsResult, audit].some((result) => result.error)) return apiError(c, 500, "dashboard_read_failed", "Could not load dashboard");
  const flocks = flocksResult.data ?? []; const records = recordsResult.data ?? []; const active = flocks.filter((flock) => flock.status === "active");
  const sum = (key: string) => records.reduce((total, row) => total + Number((row as Record<string, unknown>)[key] ?? 0), 0);
  const initialBirds = flocks.reduce((total, flock) => total + Number(flock.initial_count ?? 0), 0); const mortality = sum("mortality_count"); const culls = sum("culling_count");
  const byDate = new Map<string, { date: string; mortality: number; feed_kg: number; eggs: number; water_liters: number }>();
  for (const row of records) { const date = String(row.record_date); const item = byDate.get(date) ?? { date, mortality: 0, feed_kg: 0, eggs: 0, water_liters: 0 }; item.mortality += Number(row.mortality_count ?? 0); item.feed_kg += Number(row.feed_consumed_kg ?? 0); item.eggs += Number(row.eggs_collected ?? 0); item.water_liters += Number(row.water_consumed_liters ?? 0); byDate.set(date, item); }
  const mix = Object.values(flocks.reduce<Record<string, { type: string; count: number; birds: number }>>((acc, flock) => { const type = String(flock.poultry_type); acc[type] ??= { type, count: 0, birds: 0 }; acc[type].count += 1; acc[type].birds += Number(flock.current_count ?? 0); return acc; }, {}));
  return c.json({ farm: farm.data, summary: {
    members: members.data?.length ?? 0, accepted_members: members.data?.filter((member) => member.accepted_at).length ?? 0, units: units.data?.length ?? 0,
    flocks: flocks.length, active_flocks: active.length, total_birds: active.reduce((total, flock) => total + Number(flock.current_count ?? 0), 0), initial_birds: initialBirds,
    total_mortality: mortality, total_culls: culls, mortality_rate: initialBirds ? Number(((mortality + culls) / initialBirds * 100).toFixed(2)) : 0,
    total_feed_kg: Number(sum("feed_consumed_kg").toFixed(2)), total_water_liters: Number(sum("water_consumed_liters").toFixed(2)), total_eggs: sum("eggs_collected"), daily_records: records.length
  }, poultry_mix: mix, trends: [...byDate.values()].slice(-14), recent_records: records.slice(-8).reverse(),
  table_health: [{ table: "farms", rows: farm.data ? 1 : 0 }, { table: "farm_members", rows: members.data?.length ?? 0 }, { table: "farm_units", rows: units.data?.length ?? 0 }, { table: "flocks", rows: flocks.length }, { table: "daily_records", rows: records.length }, { table: "audit_logs", rows: audit.data?.length ?? 0 }], recent_audit_logs: audit.data ?? [] });
});

app.onError((error, c) => {
  if (error instanceof z.ZodError) return apiError(c, 400, "validation_failed", z.prettifyError(error));
  console.error(error);
  return apiError(c, 500, "internal_error", "Unexpected server error");
});

Deno.serve(app.fetch);
