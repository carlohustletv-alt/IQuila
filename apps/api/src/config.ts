import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

const required = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY"
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is required`);
  }
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const supabaseUrl = new URL(process.env.SUPABASE_URL!);
if (supabaseUrl.protocol !== "https:" && nodeEnv === "production") {
  throw new Error("SUPABASE_URL must use HTTPS in production");
}

const defaultOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const allowedOrigins = (process.env.API_ALLOWED_ORIGINS ?? (nodeEnv === "production" ? "" : defaultOrigins.join(",")))
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
if (nodeEnv === "production" && !allowedOrigins.length) {
  throw new Error("API_ALLOWED_ORIGINS is required in production");
}
if (nodeEnv === "production" && allowedOrigins.some((origin) => new URL(origin).protocol !== "https:")) {
  throw new Error("API_ALLOWED_ORIGINS must contain only HTTPS origins in production");
}

export const config = {
  nodeEnv,
  port: Number(process.env.API_PORT ?? 4000),
  supabaseUrl: supabaseUrl.origin,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY!,
  supabaseJwksUrl: new URL("/auth/v1/.well-known/jwks.json", supabaseUrl).toString(),
  allowedOrigins
};
