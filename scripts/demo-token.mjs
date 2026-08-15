import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

const email = process.env.DEMO_EMAIL ?? "demo@flockiq.local";
const password = process.env.DEMO_PASSWORD;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY || !password) {
  console.error("SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and DEMO_PASSWORD are required");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const { data, error } = await supabase.auth.signInWithPassword({ email, password });

if (error) {
  throw error;
}

console.log(data.session?.access_token ?? "");
