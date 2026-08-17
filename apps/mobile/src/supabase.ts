import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { mobileConfig } from "./config";

export const supabase = createClient(mobileConfig.supabaseUrl, mobileConfig.supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});
