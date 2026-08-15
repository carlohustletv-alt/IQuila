import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.DEMO_WORKER_EMAIL || !process.env.DEMO_WORKER_PASSWORD || !process.env.DEMO_VIEWER_EMAIL || !process.env.DEMO_VIEWER_PASSWORD) {
  throw new Error("Supabase public environment and demo worker/viewer credentials are required");
}

async function testAccount(email, password, expectedRole) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError || !authData.user) throw authError ?? new Error(`No user for ${email}`);

  const { data: farms, error: farmsError } = await client.rpc("get_my_farm_assignments");
  if (farmsError) throw farmsError;
  if (!farms?.length) throw new Error(`${email} has no assigned farms`);
  if (!farms.every((farm) => farm.role === expectedRole)) throw new Error(`${email} has an unexpected role`);

  const { data: flocks, error: flocksError } = await client
    .from("flocks")
    .select("id, farm_id, name, status")
    .eq("farm_id", farms[0].farm_id)
    .eq("status", "active")
    .is("deleted_at", null);
  if (flocksError) throw flocksError;
  if (!flocks?.length) throw new Error(`${email} cannot load assigned farm flocks`);
  if (!flocks.every((flock) => flock.farm_id === farms[0].farm_id)) throw new Error("Cross-farm flock leak");

  return { email, farms: farms.length, first_farm_flocks: flocks.length, role: expectedRole };
}

const worker = await testAccount(process.env.DEMO_WORKER_EMAIL, process.env.DEMO_WORKER_PASSWORD, "worker");
const viewer = await testAccount(process.env.DEMO_VIEWER_EMAIL, process.env.DEMO_VIEWER_PASSWORD, "viewer");

console.log(JSON.stringify({ connection: "direct-supabase", worker, viewer }, null, 2));
