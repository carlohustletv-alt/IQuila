import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

const apiUrl = process.env.API_TEST_URL ?? "http://localhost:4000";
const accounts = {
  manager: [process.env.DEMO_MANAGER_EMAIL, process.env.DEMO_MANAGER_PASSWORD],
  worker: [process.env.DEMO_WORKER_EMAIL, process.env.DEMO_WORKER_PASSWORD],
  viewer: [process.env.DEMO_VIEWER_EMAIL, process.env.DEMO_VIEWER_PASSWORD]
};

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY || Object.values(accounts).some(([email, password]) => !email || !password)) {
  throw new Error("Supabase public environment and demo account credentials are required");
}

async function tokenFor([email, password]) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`No session for ${email}`);
  return data.session.access_token;
}

async function request(token, path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...options.headers }
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [managerToken, workerToken, viewerToken] = await Promise.all([
  tokenFor(accounts.manager), tokenFor(accounts.worker), tokenFor(accounts.viewer)
]);
const workerId = JSON.parse(Buffer.from(workerToken.split(".")[1], "base64url").toString()).sub;
const viewerId = JSON.parse(Buffer.from(viewerToken.split(".")[1], "base64url").toString()).sub;

const managerFarms = await request(managerToken, "/api/farms");
const workerFarms = await request(workerToken, "/api/farms");
const viewerFarms = await request(viewerToken, "/api/farms");
assert(managerFarms.status === 200, "Manager cannot list farms");
assert(workerFarms.status === 200 && workerFarms.body.farms.length > 0, "Worker must see assigned farms");
assert(viewerFarms.status === 200 && viewerFarms.body.farms.length > 0, "Viewer must see assigned farms");
assert(workerFarms.body.farms.every((item) => item.role === "worker"), "Worker received an unexpected farm role");
assert(viewerFarms.body.farms.every((item) => item.role === "viewer"), "Viewer received an unexpected farm role");

const workerFarm = workerFarms.body.farms[0];
const workerFlocks = await request(workerToken, `/api/farms/${workerFarm.farms.id}/flocks`);
assert(workerFlocks.status === 200 && workerFlocks.body.flocks.length > 0, "Worker cannot see assigned farm flocks");
assert(workerFlocks.body.flocks.every((flock) => flock.farm_id === workerFarm.farms.id), "Worker received a flock from another farm");

const unassignedFarm = managerFarms.body.farms.find(
  (item) => !workerFarms.body.farms.some((assigned) => assigned.farms.id === item.farms.id)
);
if (unassignedFarm) {
  const forbiddenFlocks = await request(workerToken, `/api/farms/${unassignedFarm.farms.id}/flocks`);
  assert(forbiddenFlocks.status === 403, "Worker accessed an unassigned farm");
}

const workerCreateFarm = await request(workerToken, "/api/farms", {
  method: "POST",
  body: JSON.stringify({ name: "Unauthorized Worker Farm" })
});
assert(workerCreateFarm.status === 403, "Personnel account created a farm");

const workerTeam = await request(workerToken, `/api/farms/${workerFarm.farms.id}/members`);
assert(workerTeam.status === 403, "Worker accessed manager team controls");

const managerTeam = await request(managerToken, `/api/farms/${workerFarm.farms.id}/members`);
assert(managerTeam.status === 200 && managerTeam.body.members.length >= 3, "Manager cannot view assigned team");

const [managerReports, workerReports, viewerReports, managerEvidence, workerEvidence, viewerEvidence, workerDashboard, viewerDashboard] = await Promise.all([
  request(managerToken, `/api/farms/${workerFarm.farms.id}/daily-records`),
  request(workerToken, `/api/farms/${workerFarm.farms.id}/daily-records`),
  request(viewerToken, `/api/farms/${workerFarm.farms.id}/daily-records`),
  request(managerToken, `/api/farms/${workerFarm.farms.id}/evidence`),
  request(workerToken, `/api/farms/${workerFarm.farms.id}/evidence`),
  request(viewerToken, `/api/farms/${workerFarm.farms.id}/evidence`),
  request(workerToken, `/api/farms/${workerFarm.farms.id}/dashboard`),
  request(viewerToken, `/api/farms/${workerFarm.farms.id}/dashboard`)
]);
assert(managerReports.status === 200 && managerEvidence.status === 200, "Manager cannot access farm reports or evidence");
assert(workerReports.status === 200 && workerReports.body.daily_records.every((item) => item.created_by === workerId), "Worker received another user's report");
assert(viewerReports.status === 200 && viewerReports.body.daily_records.every((item) => item.created_by === viewerId), "Viewer received another user's report");
assert(workerEvidence.status === 200 && viewerEvidence.status === 200, "Personnel cannot access own evidence views");
assert(workerEvidence.body.evidence.every((item) => item.captured_by === workerId), "Worker received another user's evidence");
assert(viewerEvidence.body.evidence.every((item) => item.captured_by === viewerId), "Viewer received another user's evidence");
assert(workerDashboard.status === 403 && viewerDashboard.status === 403, "Personnel accessed farm-wide analytics");

const workerMember = managerTeam.body.members.find((member) => member.role === "worker" && member.user_id);
const actingMembership = managerFarms.body.farms.find((item) => item.farms.id === workerFarm.farms.id);
let ownerEscalationCheck = "not_applicable_owner_fixture";
if (workerMember && actingMembership?.role === "manager") {
  const managerClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await managerClient.auth.signInWithPassword({ email: accounts.manager[0], password: accounts.manager[1] });
  const escalation = await managerClient.from("farm_members").update({ role: "owner" }).eq("id", workerMember.id);
  if (!escalation.error) {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    await admin.from("farm_members").update({ role: "worker" }).eq("id", workerMember.id);
    throw new Error("Manager promoted a worker to owner through direct Supabase access");
  }
  ownerEscalationCheck = "passed";
}

const viewerFarm = viewerFarms.body.farms[0];
const viewerFlocks = await request(viewerToken, `/api/farms/${viewerFarm.farms.id}/flocks`);
const viewerCreateRecord = await request(viewerToken, `/api/farms/${viewerFarm.farms.id}/daily-records`, {
  method: "POST",
  body: JSON.stringify({
    flock_id: viewerFlocks.body.flocks[0].id,
    record_date: new Date().toISOString().slice(0, 10),
    mortality_count: 0,
    culling_count: 0,
    idempotency_key: `viewer-denied-${Date.now()}`
  })
});
assert(viewerCreateRecord.status === 403, "Viewer submitted an operational record");

console.log(JSON.stringify({
  manager_farms: managerFarms.body.farms.length,
  worker_assigned_farms: workerFarms.body.farms.length,
  viewer_assigned_farms: viewerFarms.body.farms.length,
  worker_flocks_in_selected_farm: workerFlocks.body.flocks.length,
  manager_team_members: managerTeam.body.members.length,
  report_evidence_isolation: "passed",
  owner_escalation_check: ownerEscalationCheck,
  isolation: "passed"
}, null, 2));
