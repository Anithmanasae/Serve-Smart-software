/**
 * Where each role lands after login, and which roles may reach each module.
 * Single source of truth for role-based navigation.
 */
import type { Role } from "@/types/models";

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

/**
 * Insights is the app's front door: whoever is allowed in it opens there, so
 * the first thing a shift sees is how the day is going. The fallbacks below
 * are for the roles `ROLE_ACCESS.insights` keeps out — a waiter has no
 * numbers to land on, and the kitchen has no screen but the KDS. Reading the
 * permission rather than restating it is what keeps the landing screen from
 * becoming a route the role isn't allowed to be on.
 */
export const homePathForRole = (role: Role): string => {
  if (ROLE_ACCESS.insights.includes(role)) return "/insights";
  switch (role) {
    case "kitchen":
      return "/kds";
    default:
      return "/tables";
  }
};
