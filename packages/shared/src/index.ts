export { brand } from "./brand";

export const farmRoles = ["owner", "manager", "worker", "viewer"] as const;
export type FarmRole = (typeof farmRoles)[number];

export const accountTypes = ["manager", "personnel"] as const;
export type AccountType = (typeof accountTypes)[number];

export const poultryTypes = [
  "broiler",
  "layer",
  "breeder",
  "duck",
  "turkey",
  "quail",
  "other"
] as const;
export type PoultryType = (typeof poultryTypes)[number];

export const flockStatuses = ["active", "sold", "closed"] as const;
export type FlockStatus = (typeof flockStatuses)[number];

export type Permission =
  | "farm:read"
  | "farm:update"
  | "members:manage"
  | "flocks:manage"
  | "records:create"
  | "records:update"
  | "reports:read";

const rolePermissions: Record<FarmRole, Permission[]> = {
  owner: [
    "farm:read",
    "farm:update",
    "members:manage",
    "flocks:manage",
    "records:create",
    "records:update",
    "reports:read"
  ],
  manager: [
    "farm:read",
    "farm:update",
    "members:manage",
    "flocks:manage",
    "records:create",
    "records:update",
    "reports:read"
  ],
  worker: ["farm:read", "records:create"],
  viewer: ["farm:read", "reports:read"]
};

export function hasPermission(role: FarmRole, permission: Permission) {
  return rolePermissions[role].includes(permission);
}

export interface AuthUser {
  id: string;
  email?: string;
}

export interface FarmMembership {
  farmId: string;
  userId: string;
  role: FarmRole;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
