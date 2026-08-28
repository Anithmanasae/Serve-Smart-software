/**
 * Where each role lands after login, and which roles may reach each module.
 * Single source of truth for role-based navigation.
 */
import {
  DEFAULT_CONFIG,
  type RestaurantConfig,
} from "@/features/settings/restaurantConfig";
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
 *
 * `config` is why the waiter fallback is not simply "/tables": a counter
 * business has no floor, and landing someone on a tab that its own layout
 * gave no `href` is a blank screen with no way forward. Taking the whole
 * config rather than a boolean keeps this the single place that maps a role
 * to a screen — if another module ever becomes optional, it is answered here.
 * The default keeps every existing caller and every pre-wizard restaurant on
 * exactly the route they had.
 */
export const homePathForRole = (
  role: Role,
  config: RestaurantConfig = DEFAULT_CONFIG
): string => {
  if (ROLE_ACCESS.insights.includes(role)) return "/insights";
  switch (role) {
    case "kitchen":
      return "/kds";
    default:
      return config.tablesEnabled ? "/tables" : "/order";
  }
};

/**
 * Where an owner lands the instant first-run setup finishes — which is NOT
 * where they land on an ordinary morning.
 *
 * `homePathForRole` sends an owner to Insights, and that is right every day
 * but this one: a restaurant that has never billed anything opens Insights
 * on six tiles reading ₹0.00. The wizard's last button says "Take your first
 * order", and it was handing people an accounting screen — the emptiest
 * possible answer to a promise of activity, two seconds after making it.
 *
 * So the first landing is the floor (or the order screen for a counter
 * business): the place the starter menu and tables the wizard just seeded are
 * actually visible, and the place the first order starts. Insights is
 * introduced later, by the celebration, once there is something in it.
 */
export const firstRunPathForRole = (
  role: Role,
  config: RestaurantConfig = DEFAULT_CONFIG
): string => {
  if (role === "kitchen") return "/kds";
  return config.tablesEnabled ? "/tables" : "/order";
};
