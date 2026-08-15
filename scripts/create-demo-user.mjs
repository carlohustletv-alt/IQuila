import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

const email = process.env.DEMO_EMAIL ?? "demo@flockiq.local";
const password = process.env.DEMO_PASSWORD;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY || !password) {
  console.error("SUPABASE_URL, SUPABASE_SECRET_KEY, and DEMO_PASSWORD are required");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function findUserByEmail(targetEmail) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email?.toLowerCase() === targetEmail.toLowerCase()) ?? null;
}

let user = await findUserByEmail(email);

if (!user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: "Demo Manager",
      account_type: "manager"
    }
  });

  if (error) throw error;
  user = data.user;
} else {
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: {
      full_name: "Demo Manager",
      account_type: "manager"
    }
  });

  if (error) throw error;
}

if (!user) {
  throw new Error("Could not create or find demo user");
}

await supabase.from("profiles").upsert({
  id: user.id,
  full_name: "Demo Manager",
  account_type: "manager"
});

const { data: existingFarm, error: existingFarmError } = await supabase
  .from("farms")
  .select("id")
  .eq("created_by", user.id)
  .eq("name", "Demo Poultry Farm")
  .is("deleted_at", null)
  .maybeSingle();

if (existingFarmError) throw existingFarmError;

let farmId = existingFarm?.id;

if (!farmId) {
  const { data: farm, error: farmError } = await supabase
    .from("farms")
    .insert({
      name: "Demo Poultry Farm",
      location: "Demo Location",
      notes: "Seeded demo farm for FlockIQ testing.",
      created_by: user.id
    })
    .select("id")
    .single();

  if (farmError) throw farmError;
  farmId = farm.id;
}

await supabase.from("farm_members").upsert(
  {
    farm_id: farmId,
    user_id: user.id,
    role: "owner",
    invited_by: user.id,
    accepted_at: new Date().toISOString()
  },
  { onConflict: "farm_id,user_id" }
);

const { data: existingFlock, error: existingFlockError } = await supabase
  .from("flocks")
  .select("id")
  .eq("farm_id", farmId)
  .eq("name", "Demo Broiler Batch A")
  .is("deleted_at", null)
  .maybeSingle();

if (existingFlockError) throw existingFlockError;

let flockId = existingFlock?.id;

if (!flockId) {
  const { data: flock, error: flockError } = await supabase
    .from("flocks")
    .insert({
      farm_id: farmId,
      name: "Demo Broiler Batch A",
      poultry_type: "broiler",
      breed: "Ross 308",
      start_date: new Date().toISOString().slice(0, 10),
      initial_count: 500,
      current_count: 500,
      status: "active",
      created_by: user.id
    })
    .select("id")
    .single();

  if (flockError) throw flockError;
  flockId = flock.id;
}

await supabase.from("daily_records").upsert(
  {
    farm_id: farmId,
    flock_id: flockId,
    record_date: new Date().toISOString().slice(0, 10),
    mortality_count: 0,
    culling_count: 0,
    feed_consumed_kg: 85,
    water_consumed_liters: 160,
    notes: "Demo starting record.",
    idempotency_key: "demo-starting-record",
    created_by: user.id
  },
  { onConflict: "farm_id,idempotency_key" }
);

console.log(JSON.stringify({ email, farm: "Demo Poultry Farm", flock: "Demo Broiler Batch A" }, null, 2));
