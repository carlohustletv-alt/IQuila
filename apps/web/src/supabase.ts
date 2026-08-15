import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configuredApiUrl = import.meta.env.VITE_API_URL;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
}

if (import.meta.env.PROD && new URL(supabaseUrl).protocol !== "https:") {
  throw new Error("VITE_SUPABASE_URL must use HTTPS in production");
}
if (import.meta.env.PROD && configuredApiUrl && new URL(configuredApiUrl).protocol !== "https:") {
  throw new Error("VITE_API_URL must use HTTPS in production");
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});

export const apiUrl = (configuredApiUrl ?? `${supabaseUrl}/functions/v1/flockiq-api`).replace(/\/$/, "");
