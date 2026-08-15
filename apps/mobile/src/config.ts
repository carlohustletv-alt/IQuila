const supabaseUrl = "https://vyvphaxucpzjjmjndbxw.supabase.co";

if (!supabaseUrl.startsWith("https://")) throw new Error("Android Supabase connections must use HTTPS");

export const mobileConfig = {
  supabaseUrl,
  edgeApiUrl: `${supabaseUrl}/functions/v1/flockiq-api`,
  supabasePublishableKey: "sb_publishable_nBcqliutICaOz_VIk5KSwA_5yNwQWb1"
} as const;
