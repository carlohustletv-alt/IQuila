import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
}
const requiredDemoKeys = ["DEMO_MANAGER_EMAIL", "DEMO_MANAGER_PASSWORD", "DEMO_WORKER_EMAIL", "DEMO_WORKER_PASSWORD", "DEMO_VIEWER_EMAIL", "DEMO_VIEWER_PASSWORD"];
if (requiredDemoKeys.some((key) => !process.env[key])) {
  throw new Error(`${requiredDemoKeys.join(", ")} are required`);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const users = [
  { email: process.env.DEMO_MANAGER_EMAIL, password: process.env.DEMO_MANAGER_PASSWORD, name: "Demo Manager", accountType: "manager" },
  { email: process.env.DEMO_WORKER_EMAIL, password: process.env.DEMO_WORKER_PASSWORD, name: "Demo Field Worker", accountType: "personnel" },
  { email: process.env.DEMO_VIEWER_EMAIL, password: process.env.DEMO_VIEWER_PASSWORD, name: "Demo Viewer", accountType: "personnel" }
];

async function ensureUser(definition) {
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;

  let user = listed.users.find((item) => item.email?.toLowerCase() === definition.email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: definition.email,
      password: definition.password,
      email_confirm: true,
      user_metadata: { full_name: definition.name, account_type: definition.accountType }
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: definition.password,
      email_confirm: true,
      user_metadata: { full_name: definition.name, account_type: definition.accountType }
    });
    if (error) throw error;
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: user.id,
    full_name: definition.name,
    account_type: definition.accountType
  });
  if (profileError) throw profileError;
  return user;
}

async function ensureFarm(ownerId, definition) {
  const { data: existing, error: findError } = await supabase
    .from("farms")
    .select("id")
    .eq("created_by", ownerId)
    .eq("name", definition.name)
    .is("deleted_at", null)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase.from("farms").update(definition).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await supabase
    .from("farms")
    .insert({ ...definition, created_by: ownerId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureMembership(farmId, userId, role, ownerId) {
  const { error } = await supabase.from("farm_members").upsert(
    {
      farm_id: farmId,
      user_id: userId,
      role,
      invited_by: ownerId,
      accepted_at: new Date().toISOString(),
      deleted_at: null
    },
    { onConflict: "farm_id,user_id" }
  );
  if (error) throw error;
}

async function ensureUnit(farmId, ownerId, name, notes) {
  const { data: existing, error: findError } = await supabase
    .from("farm_units")
    .select("id")
    .eq("farm_id", farmId)
    .eq("name", name)
    .is("deleted_at", null)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("farm_units")
    .insert({ farm_id: farmId, name, notes, created_by: ownerId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureFlock(farmId, ownerId, definition) {
  const { data: existing, error: findError } = await supabase
    .from("flocks")
    .select("id")
    .eq("farm_id", farmId)
    .eq("name", definition.name)
    .is("deleted_at", null)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase.from("flocks").update(definition).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await supabase
    .from("flocks")
    .insert({ ...definition, farm_id: farmId, created_by: ownerId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function dailyRecord(farmId, flockId, ownerId, farmKey, flockKey, day, values) {
  return {
    farm_id: farmId,
    flock_id: flockId,
    record_date: dateDaysAgo(day),
    mortality_count: values.mortality,
    culling_count: values.culls ?? 0,
    feed_consumed_kg: values.feed,
    water_consumed_liters: values.water,
    eggs_collected: values.eggs ?? null,
    average_weight_grams: values.weight ?? null,
    notes: values.notes ?? "Routine demo farm entry.",
    idempotency_key: `seed-${farmKey}-${flockKey}-${dateDaysAgo(day)}`,
    created_by: ownerId,
    deleted_at: null
  };
}

const [owner, worker, viewer] = await Promise.all(users.map(ensureUser));

const greenValleyId = await ensureFarm(owner.id, {
  name: "Green Valley Poultry",
  location: "Nakuru County",
  notes: "Mixed poultry demonstration farm with broilers and layers."
});
const sunriseId = await ensureFarm(owner.id, {
  name: "Sunrise Birds Farm",
  location: "Kiambu County",
  notes: "Small commercial turkey and quail operation."
});

for (const farmId of [greenValleyId, sunriseId]) {
  await ensureMembership(farmId, owner.id, "owner", owner.id);
  await ensureMembership(farmId, worker.id, "worker", owner.id);
  await ensureMembership(farmId, viewer.id, "viewer", owner.id);
}

const brooderId = await ensureUnit(greenValleyId, owner.id, "Brooder House A", "Heating and starter section.");
const layerHouseId = await ensureUnit(greenValleyId, owner.id, "Layer House 1", "Deep-litter laying house.");
const turkeyUnitId = await ensureUnit(sunriseId, owner.id, "Turkey Barn", "Naturally ventilated grow-out barn.");
const quailUnitId = await ensureUnit(sunriseId, owner.id, "Quail Unit", "Multi-tier quail cages."
);

const broilerId = await ensureFlock(greenValleyId, owner.id, {
  farm_unit_id: brooderId,
  name: "Broiler Batch 24-A",
  poultry_type: "broiler",
  breed: "Ross 308",
  start_date: dateDaysAgo(28),
  initial_count: 1200,
  current_count: 1178,
  status: "active"
});
const layerId = await ensureFlock(greenValleyId, owner.id, {
  farm_unit_id: layerHouseId,
  name: "Layer Flock L-07",
  poultry_type: "layer",
  breed: "Lohmann Brown",
  start_date: dateDaysAgo(210),
  initial_count: 800,
  current_count: 773,
  status: "active"
});
const turkeyId = await ensureFlock(sunriseId, owner.id, {
  farm_unit_id: turkeyUnitId,
  name: "Turkey Growers T-03",
  poultry_type: "turkey",
  breed: "Broad Breasted White",
  start_date: dateDaysAgo(70),
  initial_count: 320,
  current_count: 308,
  status: "active"
});
const quailId = await ensureFlock(sunriseId, owner.id, {
  farm_unit_id: quailUnitId,
  name: "Quail Layers Q-02",
  poultry_type: "quail",
  breed: "Japanese Coturnix",
  start_date: dateDaysAgo(130),
  initial_count: 600,
  current_count: 574,
  status: "active"
});

const records = [];
for (let day = 20; day >= 0; day -= 1) {
  records.push(dailyRecord(greenValleyId, broilerId, owner.id, "green", "broiler", day, {
    mortality: day % 5 === 0 ? 2 : day % 3 === 0 ? 1 : 0,
    feed: 92 + (20 - day) * 2.8,
    water: 170 + (20 - day) * 4.5,
    weight: 720 + (20 - day) * 58
  }));
  records.push(dailyRecord(greenValleyId, layerId, owner.id, "green", "layer", day, {
    mortality: day % 9 === 0 ? 1 : 0,
    feed: 88 + (day % 4),
    water: 145 + (day % 5) * 2,
    eggs: 615 + ((20 - day) % 7) * 9,
    weight: 1810
  }));
  records.push(dailyRecord(sunriseId, turkeyId, owner.id, "sunrise", "turkey", day, {
    mortality: day % 11 === 0 ? 1 : 0,
    feed: 71 + (20 - day) * 1.4,
    water: 116 + (20 - day) * 2.2,
    weight: 3100 + (20 - day) * 105
  }));
  records.push(dailyRecord(sunriseId, quailId, owner.id, "sunrise", "quail", day, {
    mortality: day % 8 === 0 ? 1 : 0,
    feed: 18 + (day % 3),
    water: 31 + (day % 4),
    eggs: 438 + ((20 - day) % 6) * 7,
    weight: 245
  }));
}

const { error: recordsError } = await supabase
  .from("daily_records")
  .upsert(records, { onConflict: "farm_id,idempotency_key" });
if (recordsError) throw recordsError;

await supabase.from("audit_logs").delete().eq("actor_id", owner.id).contains("metadata", { source: "demo-seed" });
const auditRows = [
  [greenValleyId, "farm.created", "farms", greenValleyId],
  [greenValleyId, "flock.created", "flocks", broilerId],
  [greenValleyId, "flock.created", "flocks", layerId],
  [sunriseId, "farm.created", "farms", sunriseId],
  [sunriseId, "flock.created", "flocks", turkeyId],
  [sunriseId, "flock.created", "flocks", quailId]
].map(([farm_id, action, entity_table, entity_id], index) => ({
  farm_id,
  actor_id: owner.id,
  action,
  entity_table,
  entity_id,
  metadata: { source: "demo-seed", sequence: index + 1 }
}));
const { error: auditError } = await supabase.from("audit_logs").insert(auditRows);
if (auditError) throw auditError;

console.log(JSON.stringify({
  users: users.map(({ email, password, name }) => ({ email, password, name })),
  farms: 2,
  units: 4,
  flocks: 4,
  daily_records: records.length,
  audit_logs: auditRows.length
}, null, 2));
