/**
 * HOW THIS RESTAURANT WORKS — the setup wizard's answers, resolved.
 *
 * One place decides what an absent field means, because the answer is
 * load-bearing: **absent = the app as it was before the wizard existed.**
 * Every restaurant registered before this shipped has none of these fields,
 * and every one of them must keep its kitchen display and its floor. Anything
 * that read `doc.kotEnabled` directly would get `undefined` and quietly turn
 * the KDS off for the entire existing customer base, so nothing does — it all
 * comes through `resolveRestaurantConfig`.
 *
 * The values ride on the restaurant root doc, which `AuthContext` already
 * subscribes to for the trial clock, so reading config costs no extra
 * listener and updates live: an owner changing an answer re-shapes every
 * signed-in device in the restaurant without a restart.
 */
import type { RestaurantProfile } from "@/types/models";

export type BusinessType = NonNullable<RestaurantProfile["businessType"]>;

export interface RestaurantConfig {
  businessType: BusinessType | null;
  /** Orders become kitchen tickets before they are billed. */
  kotEnabled: boolean;
  /** This restaurant seats guests at tables. */
  tablesEnabled: boolean;
  /** The owner has not finished first-run setup yet. */
  needsSetup: boolean;
}

/** What the app assumes about a restaurant that has never answered. */
export const DEFAULT_CONFIG: RestaurantConfig = {
  businessType: null,
  kotEnabled: true,
  tablesEnabled: true,
  needsSetup: false,
};

export function resolveRestaurantConfig(
  doc: RestaurantProfile | null | undefined
): RestaurantConfig {
  if (!doc) return DEFAULT_CONFIG;
  return {
    businessType: doc.businessType ?? null,
    // `?? true`, never `!== false` — an absent field and an explicit `true`
    // must be indistinguishable to every reader.
    kotEnabled: doc.kotEnabled ?? true,
    tablesEnabled: doc.tablesEnabled ?? true,
    needsSetup: doc.needsSetup === true,
  };
}
