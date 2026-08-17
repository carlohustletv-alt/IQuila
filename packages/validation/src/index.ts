import { farmRoles, flockStatuses, poultryTypes } from "@flockiq/shared";
import { z } from "zod";

export const uuidSchema = z.uuid();

export const createFarmSchema = z.object({
  name: z.string().trim().min(2).max(120),
  location: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional()
});

export const updateFarmSchema = createFarmSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

export const inviteMemberSchema = z.object({
  email: z.email().toLowerCase(),
  role: z.enum(farmRoles).exclude(["owner"])
});

export const updateMemberSchema = z.object({
  role: z.enum(farmRoles).exclude(["owner"])
});

export const memberPermissionsSchema = z.object({
  dashboard: z.boolean(),
  flocks: z.boolean(),
  team: z.boolean(),
  evidence: z.boolean(),
  reports: z.boolean()
});

export const updateSystemRoleSchema = z.object({
  system_role: z.enum(["user", "superadmin"])
});

export const createFlockSchema = z.object({
  farm_unit_id: uuidSchema.optional(),
  name: z.string().trim().min(2).max(120),
  poultry_type: z.enum(poultryTypes),
  custom_poultry_type: z.string().trim().max(80).optional(),
  breed: z.string().trim().max(120).optional(),
  start_date: z.iso.date(),
  initial_count: z.number().int().positive(),
  status: z.enum(flockStatuses).default("active")
});

export const dailyRecordSchema = z.object({
  id: uuidSchema.optional(),
  farm_id: uuidSchema,
  flock_id: uuidSchema,
  record_date: z.iso.date(),
  mortality_count: z.number().int().min(0).default(0),
  culling_count: z.number().int().min(0).default(0),
  feed_consumed_kg: z.number().min(0).optional(),
  water_consumed_liters: z.number().min(0).optional(),
  eggs_collected: z.number().int().min(0).optional(),
  average_weight_grams: z.number().min(0).optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotency_key: z.string().trim().min(8).max(120)
}).strip();

export const syncPushSchema = z.object({
  farm_id: uuidSchema,
  device_id: z.string().trim().min(6).max(120),
  changes: z.array(
    z.object({
      table: z.enum(["daily_records"]),
      operation: z.enum(["insert", "update", "delete"]),
      payload: z.record(z.string(), z.unknown()),
      idempotency_key: z.string().trim().min(8).max(120)
    })
  ).max(200)
});
