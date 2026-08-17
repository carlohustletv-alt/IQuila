// SPDX-FileCopyrightText: 2026 carlohustletv
// SPDX-License-Identifier: GPL-3.0-only

import { createSupabaseAdminClient } from "@flockiq/supabase";
import {
  createFarmSchema,
  createFlockSchema,
  dailyRecordSchema,
  inviteMemberSchema,
  memberPermissionsSchema,
  syncPushSchema,
  updateSystemRoleSchema,
  updateMemberSchema,
  updateFarmSchema,
  uuidSchema
} from "@flockiq/validation";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";
import { getFarmRole, requireFarmPermission, verifySupabaseJwt } from "./auth.js";
import { config } from "./config.js";
import { errorResponse, getBearerToken } from "./http.js";

const supabase = createSupabaseAdminClient({
  SUPABASE_URL: config.supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: config.supabasePublishableKey,
  SUPABASE_SECRET_KEY: config.supabaseSecretKey
});

type Variables = {
  user: Awaited<ReturnType<typeof verifySupabaseJwt>>;
};

const app = new Hono<{ Variables: Variables }>();

async function requireSuperadmin(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("system_role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.system_role === "superadmin";
}

async function ensureFlockBelongsToFarm(farmId: string, flockId: string) {
  const { data, error } = await supabase
    .from("flocks")
    .select("id")
    .eq("id", flockId)
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

app.use("*", logger());
app.use("*", cors({
  origin: (origin) => config.allowedOrigins.includes(origin.replace(/\/$/, "")) ? origin : undefined,
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
  maxAge: 86400
}));

app.get("/health", (c) => c.json({ ok: true }));

app.get("/health/supabase", async (c) => {
  const { error } = await supabase.from("farms").select("id", { count: "exact", head: true });

  if (error) {
    return errorResponse(c, 503, "supabase_unavailable", "Database dependency unavailable");
  }

  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    return errorResponse(c, 401, "unauthorized", "Missing bearer token");
  }

  try {
    const user = await verifySupabaseJwt(token);
    c.set("user", user);
    await next();
  } catch {
    return errorResponse(c, 401, "unauthorized", "Invalid bearer token");
  }
});

app.get("/api/auth/me", async (c) => {
  const user = c.get("user");
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) return errorResponse(c, 500, "profile_read_failed", error.message);
  return c.json({ user, profile: data });
});

app.get("/api/admin/overview", async (c) => {
  const user = c.get("user");
  if (!(await requireSuperadmin(user.id))) return errorResponse(c, 403, "superadmin_required", "Superadmin access required");

  const [profiles, farms, members, flocks, records, evidence, authUsers] = await Promise.all([
    supabase.from("profiles").select("id, full_name, account_type, system_role, created_at").order("created_at", { ascending: false }),
    supabase.from("farms").select("id, name, location, created_by, created_at").is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("farm_members").select("id, farm_id, user_id, role, permissions, accepted_at").is("deleted_at", null),
    supabase.from("flocks").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("daily_records").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("field_evidence").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  ]);
  const failure = [profiles, farms, members, flocks, records, evidence, authUsers].find((result) => result.error)?.error;
  if (failure) return errorResponse(c, 500, "admin_overview_failed", failure.message);

  const emailById = new Map(authUsers.data.users.map((account) => [account.id, account.email]));
  const profileRows = profiles.data ?? [];
  const farmRows = farms.data ?? [];
  const membershipRows = members.data ?? [];
  return c.json({
    summary: {
      users: profileRows.length,
      farms: farmRows.length,
      memberships: membershipRows.length,
      flocks: flocks.count ?? 0,
      daily_records: records.count ?? 0,
      evidence: evidence.count ?? 0
    },
    users: profileRows.map((profile) => ({ ...profile, email: emailById.get(profile.id) ?? null })),
    farms: farmRows,
    memberships: membershipRows
  });
});

app.patch("/api/admin/users/:userId/system-role", async (c) => {
  const user = c.get("user");
  if (!(await requireSuperadmin(user.id))) return errorResponse(c, 403, "superadmin_required", "Superadmin access required");
  const userId = uuidSchema.parse(c.req.param("userId"));
  const body = updateSystemRoleSchema.parse(await c.req.json());
  if (userId === user.id && body.system_role !== "superadmin") {
    return errorResponse(c, 400, "self_demotion_blocked", "You cannot remove your own superadmin access");
  }
  const { data, error } = await supabase.from("profiles").update(body).eq("id", userId).select("*").single();
  if (error) return errorResponse(c, 400, "system_role_update_failed", error.message);
  return c.json({ profile: data });
});

app.get("/api/farms", async (c) => {
  const user = c.get("user");
  type FarmMembershipRow = { role: "owner" | "manager" | "worker" | "viewer"; permissions?: Record<string, boolean>; farms: Record<string, unknown>[] };
  const membershipResult = await supabase
    .from("farm_members")
    .select("role, permissions, farms(*)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .not("accepted_at", "is", null);
  let data = membershipResult.data as FarmMembershipRow[] | null;
  let error = membershipResult.error;

  if (error?.code === "42703") {
    const fallback = await supabase
      .from("farm_members")
      .select("role, farms(*)")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .not("accepted_at", "is", null);
    data = fallback.data as FarmMembershipRow[] | null;
    error = fallback.error;
  }

  if (error) return errorResponse(c, 500, "farms_read_failed", error.message);
  const creatorIds = (data ?? []).flatMap((item) => {
    const farm = Array.isArray(item.farms) ? item.farms[0] : item.farms;
    return farm?.created_by ? [farm.created_by] : [];
  });
  const { data: managers, error: managersError } = creatorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", creatorIds)
    : { data: [], error: null };
  if (managersError) return errorResponse(c, 500, "managers_read_failed", managersError.message);
  const managerById = new Map((managers ?? []).map((manager) => [manager.id, manager.full_name]));

  return c.json({
    farms: (data ?? []).map((item) => {
      const farm = Array.isArray(item.farms) ? item.farms[0] : item.farms;
      return {
        ...item,
        permissions: item.permissions ?? {
          dashboard: item.role !== "worker",
          flocks: true,
          team: item.role === "owner" || item.role === "manager",
          evidence: true,
          reports: item.role !== "worker"
        },
        manager: {
          id: farm?.created_by ?? null,
          full_name: farm?.created_by ? managerById.get(farm.created_by) ?? "Farm manager" : "Farm manager"
        }
      };
    })
  });
});

app.post("/api/farms", async (c) => {
  const user = c.get("user");
  const body = createFarmSchema.parse(await c.req.json());

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("account_type, membership_status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return errorResponse(c, 500, "profile_read_failed", profileError.message);
  if (profile?.account_type !== "manager" || profile.membership_status !== "active") {
    return errorResponse(c, 403, "membership_required", "An active manager membership is required to register farms");
  }

  const { data: farm, error: farmError } = await supabase
    .from("farms")
    .insert({ ...body, created_by: user.id })
    .select("*")
    .single();

  if (farmError) return errorResponse(c, 500, "farm_create_failed", farmError.message);

  const { error: memberError } = await supabase.from("farm_members").insert({
    farm_id: farm.id,
    user_id: user.id,
    role: "owner",
    invited_by: user.id,
    accepted_at: new Date().toISOString()
  });

  if (memberError) return errorResponse(c, 500, "farm_owner_create_failed", memberError.message);
  return c.json({ farm }, 201);
});

app.patch("/api/farms/:farmId", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "farm:update");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot update this farm");

  const body = updateFarmSchema.parse(await c.req.json());
  const { data, error } = await supabase.from("farms").update(body).eq("id", farmId).select("*").single();
  if (error) return errorResponse(c, 500, "farm_update_failed", error.message);
  return c.json({ farm: data });
});

app.post("/api/farms/:farmId/members", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "members:manage");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot manage members for this farm");

  const body = inviteMemberSchema.parse(await c.req.json());
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) return errorResponse(c, 500, "users_read_failed", usersError.message);
  const registeredUser = users.users.find((item) => item.email?.toLowerCase() === body.email);

  const { data, error } = await supabase
    .from("farm_members")
    .upsert({
      farm_id: farmId,
      user_id: registeredUser?.id ?? null,
      invited_email: registeredUser ? null : body.email,
      role: body.role,
      invited_by: user.id,
      accepted_at: registeredUser ? new Date().toISOString() : null,
      deleted_at: null
    }, registeredUser ? { onConflict: "farm_id,user_id" } : { onConflict: "farm_id,invited_email" })
    .select("*")
    .single();

  if (error) return errorResponse(c, 500, "member_invite_failed", error.message);
  return c.json({ member: data }, 201);
});

app.get("/api/farms/:farmId/members", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "members:manage");
  if (!role) return errorResponse(c, 403, "forbidden", "Only farm managers can view this team");

  type MemberRow = { id: string; user_id: string | null; invited_email: string | null; role: "owner" | "manager" | "worker" | "viewer"; permissions?: Record<string, boolean>; accepted_at: string | null; created_at: string };
  const memberResult = await supabase
    .from("farm_members")
    .select("id, user_id, invited_email, role, permissions, accepted_at, created_at")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("created_at");
  let members = memberResult.data as MemberRow[] | null;
  let error = memberResult.error;
  if (error?.code === "42703") {
    const fallback = await supabase
      .from("farm_members")
      .select("id, user_id, invited_email, role, accepted_at, created_at")
      .eq("farm_id", farmId)
      .is("deleted_at", null)
      .order("created_at");
    members = fallback.data as MemberRow[] | null;
    error = fallback.error;
  }
  if (error) return errorResponse(c, 500, "members_read_failed", error.message);

  const userIds = (members ?? []).flatMap((member) => member.user_id ? [member.user_id] : []);
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, account_type").in("id", userIds)
    : { data: [], error: null };
  if (profilesError) return errorResponse(c, 500, "profiles_read_failed", profilesError.message);

  const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authError) return errorResponse(c, 500, "users_read_failed", authError.message);
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const emailById = new Map(authUsers.users.map((account) => [account.id, account.email]));

  return c.json({
    members: (members ?? []).map((member) => ({
      ...member,
      permissions: member.permissions ?? {
        dashboard: member.role !== "worker",
        flocks: true,
        team: member.role === "owner" || member.role === "manager",
        evidence: true,
        reports: member.role !== "worker"
      },
      email: member.user_id ? emailById.get(member.user_id) ?? null : member.invited_email,
      full_name: member.user_id ? profileById.get(member.user_id)?.full_name ?? null : null,
      account_type: member.user_id ? profileById.get(member.user_id)?.account_type ?? "personnel" : "personnel",
      status: member.accepted_at ? "active" : "invited"
    }))
  });
});

app.patch("/api/farms/:farmId/members/:memberId", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const memberId = uuidSchema.parse(c.req.param("memberId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "members:manage");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot manage this farm team");
  const body = updateMemberSchema.parse(await c.req.json());

  const { data, error } = await supabase
    .from("farm_members")
    .update({ role: body.role })
    .eq("id", memberId)
    .eq("farm_id", farmId)
    .neq("role", "owner")
    .select("*")
    .single();
  if (error) return errorResponse(c, 400, "member_update_failed", error.message);
  return c.json({ member: data });
});

app.patch("/api/farms/:farmId/members/:memberId/permissions", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const memberId = uuidSchema.parse(c.req.param("memberId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "members:manage");
  const superadmin = await requireSuperadmin(user.id);
  if (!role && !superadmin) return errorResponse(c, 403, "forbidden", "You cannot manage this member's views");
  const permissions = memberPermissionsSchema.parse(await c.req.json());
  const { data, error } = await supabase
    .from("farm_members")
    .update({ permissions })
    .eq("id", memberId)
    .eq("farm_id", farmId)
    .neq("role", "owner")
    .select("*")
    .single();
  if (error) return errorResponse(c, 400, "permissions_update_failed", error.message);
  return c.json({ member: data });
});

app.get("/api/farms/:farmId/evidence", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await getFarmRole(supabase, farmId, user.id);
  const superadmin = await requireSuperadmin(user.id);
  if (!role && !superadmin) return errorResponse(c, 403, "forbidden", "You cannot view evidence for this farm");

  let query = supabase
    .from("field_evidence")
    .select("id, farm_id, flock_id, captured_by, storage_path, latitude, longitude, accuracy_meters, device_captured_at, server_received_at, timezone, notes")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("device_captured_at", { ascending: false })
    .limit(500);
  if (!superadmin && role && !["owner", "manager"].includes(role)) query = query.eq("captured_by", user.id);
  const { data, error } = await query;
  if (error) return errorResponse(c, 500, "evidence_read_failed", error.message);

  const paths = data.map((item) => item.storage_path);
  const { data: signed, error: signedError } = paths.length
    ? await supabase.storage.from("field-evidence").createSignedUrls(paths, 3600)
    : { data: [], error: null };
  if (signedError) return errorResponse(c, 500, "evidence_urls_failed", signedError.message);
  const urlByPath = new Map((signed ?? []).map((item, index) => [paths[index], item.signedUrl]));

  const userIds = [...new Set(data.map((item) => item.captured_by))];
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [], error: null };
  if (profilesError) return errorResponse(c, 500, "evidence_profiles_failed", profilesError.message);
  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));

  return c.json({ evidence: data.map((item) => ({ ...item, signed_url: urlByPath.get(item.storage_path) ?? null, captured_by_name: nameById.get(item.captured_by) ?? "Personnel" })) });
});

app.delete("/api/farms/:farmId/members/:memberId", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const memberId = uuidSchema.parse(c.req.param("memberId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "members:manage");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot manage this farm team");

  const { error } = await supabase
    .from("farm_members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("farm_id", farmId)
    .neq("role", "owner");
  if (error) return errorResponse(c, 400, "member_remove_failed", error.message);
  return c.body(null, 204);
});

app.get("/api/farms/:farmId/flocks", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "farm:read");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot view this farm");

  const { data, error } = await supabase
    .from("flocks")
    .select("*")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return errorResponse(c, 500, "flocks_read_failed", error.message);
  return c.json({ flocks: data });
});

app.get("/api/farms/:farmId/dashboard", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await getFarmRole(supabase, farmId, user.id);
  if (!role || !["owner", "manager"].includes(role)) return errorResponse(c, 403, "forbidden", "Only owners and managers can view farm-wide analytics");

  const [farmResult, membersResult, unitsResult, flocksResult, recordsResult, auditResult] = await Promise.all([
    supabase.from("farms").select("id, name, location, notes, created_at").eq("id", farmId).single(),
    supabase.from("farm_members").select("id, role, accepted_at, created_at").eq("farm_id", farmId).is("deleted_at", null),
    supabase.from("farm_units").select("id, name, created_at").eq("farm_id", farmId).is("deleted_at", null),
    supabase.from("flocks").select("id, name, poultry_type, current_count, initial_count, status, start_date, created_at").eq("farm_id", farmId).is("deleted_at", null),
    supabase.from("daily_records").select("id, flock_id, record_date, mortality_count, culling_count, feed_consumed_kg, water_consumed_liters, eggs_collected, average_weight_grams, created_at").eq("farm_id", farmId).is("deleted_at", null).order("record_date", { ascending: true }),
    supabase.from("audit_logs").select("id, action, entity_table, created_at").eq("farm_id", farmId).order("created_at", { ascending: false }).limit(8)
  ]);

  const firstError = [farmResult, membersResult, unitsResult, flocksResult, recordsResult, auditResult].find((result) => result.error)?.error;
  if (firstError) return errorResponse(c, 500, "dashboard_read_failed", firstError.message);

  const flocks = flocksResult.data ?? [];
  const records = recordsResult.data ?? [];
  const activeFlocks = flocks.filter((flock) => flock.status === "active");
  const totalBirds = activeFlocks.reduce((sum, flock) => sum + Number(flock.current_count ?? 0), 0);
  const initialBirds = flocks.reduce((sum, flock) => sum + Number(flock.initial_count ?? 0), 0);
  const totalMortality = records.reduce((sum, record) => sum + Number(record.mortality_count ?? 0), 0);
  const totalCulls = records.reduce((sum, record) => sum + Number(record.culling_count ?? 0), 0);
  const totalFeedKg = records.reduce((sum, record) => sum + Number(record.feed_consumed_kg ?? 0), 0);
  const totalWaterLiters = records.reduce((sum, record) => sum + Number(record.water_consumed_liters ?? 0), 0);
  const totalEggs = records.reduce((sum, record) => sum + Number(record.eggs_collected ?? 0), 0);

  const byDate = new Map<string, { date: string; mortality: number; feed_kg: number; eggs: number; water_liters: number }>();
  for (const record of records) {
    const date = String(record.record_date);
    const item = byDate.get(date) ?? { date, mortality: 0, feed_kg: 0, eggs: 0, water_liters: 0 };
    item.mortality += Number(record.mortality_count ?? 0);
    item.feed_kg += Number(record.feed_consumed_kg ?? 0);
    item.eggs += Number(record.eggs_collected ?? 0);
    item.water_liters += Number(record.water_consumed_liters ?? 0);
    byDate.set(date, item);
  }

  const poultryMix = Object.values(
    flocks.reduce<Record<string, { type: string; count: number; birds: number }>>((acc, flock) => {
      const type = String(flock.poultry_type);
      acc[type] ??= { type, count: 0, birds: 0 };
      acc[type].count += 1;
      acc[type].birds += Number(flock.current_count ?? 0);
      return acc;
    }, {})
  );

  const tableHealth = [
    { table: "farms", rows: farmResult.data ? 1 : 0 },
    { table: "farm_members", rows: membersResult.data?.length ?? 0 },
    { table: "farm_units", rows: unitsResult.data?.length ?? 0 },
    { table: "flocks", rows: flocks.length },
    { table: "daily_records", rows: records.length },
    { table: "audit_logs", rows: auditResult.data?.length ?? 0 }
  ];

  return c.json({
    farm: farmResult.data,
    summary: {
      members: membersResult.data?.length ?? 0,
      accepted_members: membersResult.data?.filter((member) => member.accepted_at).length ?? 0,
      units: unitsResult.data?.length ?? 0,
      flocks: flocks.length,
      active_flocks: activeFlocks.length,
      total_birds: totalBirds,
      initial_birds: initialBirds,
      total_mortality: totalMortality,
      total_culls: totalCulls,
      mortality_rate: initialBirds ? Number(((totalMortality + totalCulls) / initialBirds * 100).toFixed(2)) : 0,
      total_feed_kg: Number(totalFeedKg.toFixed(2)),
      total_water_liters: Number(totalWaterLiters.toFixed(2)),
      total_eggs: totalEggs,
      daily_records: records.length
    },
    poultry_mix: poultryMix,
    trends: Array.from(byDate.values()).slice(-14),
    recent_records: records.slice(-8).reverse(),
    table_health: tableHealth,
    recent_audit_logs: auditResult.data ?? []
  });
});

app.post("/api/farms/:farmId/flocks", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "flocks:manage");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot manage flocks for this farm");

  const body = createFlockSchema.parse(await c.req.json());
  const { data, error } = await supabase
    .from("flocks")
    .insert({ ...body, farm_id: farmId, current_count: body.initial_count, created_by: user.id })
    .select("*")
    .single();

  if (error) return errorResponse(c, 500, "flock_create_failed", error.message);
  return c.json({ flock: data }, 201);
});

app.post("/api/farms/:farmId/daily-records", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await requireFarmPermission(supabase, farmId, user.id, "records:create");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot create records for this farm");

  const body = dailyRecordSchema.parse({ ...(await c.req.json()), farm_id: farmId });
  const flockMatchesFarm = await ensureFlockBelongsToFarm(farmId, body.flock_id);
  if (!flockMatchesFarm) return errorResponse(c, 400, "invalid_flock", "Flock does not belong to this farm");

  const { data, error } = await supabase
    .from("daily_records")
    .upsert({ ...body, created_by: user.id }, { onConflict: "farm_id,idempotency_key" })
    .select("*")
    .single();

  if (error) return errorResponse(c, 500, "daily_record_create_failed", error.message);
  return c.json({ daily_record: data }, 201);
});

app.get("/api/farms/:farmId/daily-records", async (c) => {
  const user = c.get("user");
  const farmId = uuidSchema.parse(c.req.param("farmId"));
  const role = await getFarmRole(supabase, farmId, user.id);
  const isSuperadmin = await requireSuperadmin(user.id);
  if (!role && !isSuperadmin) return errorResponse(c, 403, "forbidden", "You cannot view reports for this farm");
  let query = supabase.from("daily_records")
    .select("id, farm_id, flock_id, record_date, mortality_count, culling_count, feed_consumed_kg, water_consumed_liters, eggs_collected, average_weight_grams, notes, idempotency_key, created_by, created_at, updated_at")
    .eq("farm_id", farmId).is("deleted_at", null).order("record_date", { ascending: false }).limit(500);
  if (!isSuperadmin && role && !["owner", "manager"].includes(role)) query = query.eq("created_by", user.id);
  const { data, error } = await query;
  if (error) return errorResponse(c, 500, "daily_records_read_failed", "Could not load reports");
  return c.json({ daily_records: data });
});

app.post("/api/sync/push", async (c) => {
  const user = c.get("user");
  const body = syncPushSchema.parse(await c.req.json());
  const role = await requireFarmPermission(supabase, body.farm_id, user.id, "records:create");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot sync records for this farm");

  const results = [];
  for (const change of body.changes) {
    if (change.table !== "daily_records") continue;

    const payload = dailyRecordSchema.parse({ ...change.payload, farm_id: body.farm_id, idempotency_key: change.idempotency_key });
    const flockMatchesFarm = await ensureFlockBelongsToFarm(body.farm_id, payload.flock_id);

    if (!flockMatchesFarm) {
      results.push({
        idempotency_key: change.idempotency_key,
        ok: false,
        record: null,
        error: "Flock does not belong to this farm"
      });
      continue;
    }

    const { data, error } = await supabase
      .from("daily_records")
      .upsert({ ...payload, created_by: user.id }, { onConflict: "farm_id,idempotency_key" })
      .select("*")
      .single();

    results.push({ idempotency_key: change.idempotency_key, ok: !error, record: data, error: error?.message });
  }

  return c.json({ results, server_time: new Date().toISOString() });
});

app.get("/api/sync/pull", async (c) => {
  const user = c.get("user");
  const query = z.object({ farmId: uuidSchema, since: z.iso.datetime().optional() }).parse(c.req.query());
  const role = await requireFarmPermission(supabase, query.farmId, user.id, "farm:read");
  if (!role) return errorResponse(c, 403, "forbidden", "You cannot sync this farm");

  let request = supabase.from("daily_records").select("*").eq("farm_id", query.farmId).order("updated_at");
  if (query.since) request = request.gt("updated_at", query.since);

  const { data, error } = await request;
  if (error) return errorResponse(c, 500, "sync_pull_failed", error.message);
  return c.json({ server_time: new Date().toISOString(), daily_records: data });
});

app.onError((error, c) => {
  if (error instanceof z.ZodError) {
    return errorResponse(c, 400, "validation_failed", z.prettifyError(error));
  }

  console.error(error);
  return errorResponse(c, 500, "internal_error", "Unexpected server error");
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`IQuila API listening on port ${info.port}`);
});
