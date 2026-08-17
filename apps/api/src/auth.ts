import type { FarmRole } from "@flockiq/shared";
import { hasPermission, type AuthUser, type Permission } from "@flockiq/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

const jwks = createRemoteJWKSet(new URL(config.supabaseJwksUrl));

export async function verifySupabaseJwt(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${config.supabaseUrl}/auth/v1`,
    audience: "authenticated"
  });

  if (!payload.sub) {
    throw new Error("Token is missing subject");
  }

  return typeof payload.email === "string" ? { id: payload.sub, email: payload.email } : { id: payload.sub };
}

export async function getFarmRole(
  supabase: SupabaseClient,
  farmId: string,
  userId: string
): Promise<FarmRole | null> {
  const [membership, entitlement] = await Promise.all([
    supabase
      .from("farm_members")
      .select("role, farms!inner(id)")
      .eq("farm_id", farmId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .not("accepted_at", "is", null)
      .is("farms.deleted_at", null)
      .maybeSingle(),
    supabase.rpc("is_farm_entitled", { target_farm_id: farmId })
  ]);

  if (membership.error || entitlement.error) {
    throw membership.error ?? entitlement.error;
  }

  return entitlement.data ? (membership.data?.role as FarmRole | undefined) ?? null : null;
}

export async function requireFarmPermission(
  supabase: SupabaseClient,
  farmId: string,
  userId: string,
  permission: Permission
) {
  const role = await getFarmRole(supabase, farmId, userId);

  if (!role || !hasPermission(role, permission)) {
    return null;
  }

  return role;
}
