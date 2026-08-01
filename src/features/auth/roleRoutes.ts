/**
 * Where each role lands after login, and which roles may reach each module.
 * Single source of truth for role-based navigation.
 */
import type { Role } from "@/types/models";

export const homePathForRole = (role: Role): string => {
  switch (role) {
    case "admin":
      return "/insights";
    case "waiter":
      return "/tables";
    case "cashier":
      return "/bills";
    case "kitchen":
      return "/kds";
  }
};

/** Which roles are permitted in each module (used by ProtectedRoute). */
export const ROLE_ACCESS = {
  insights: ["admin", "cashier"] as Role[],
  // Admin-only as a *tab*; cashiers reach Menu Management via Account → Menu.
  menuAdmin: ["admin"] as Role[],
  tables: ["admin", "waiter", "cashier"] as Role[],
  order: ["admin", "waiter", "cashier"] as Role[],
  kds: ["admin", "kitchen", "cashier"] as Role[],
  bills: ["admin", "cashier"] as Role[],
};
