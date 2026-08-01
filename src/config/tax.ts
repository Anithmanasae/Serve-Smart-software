/**
 * Tax configuration — Karnataka, India (standalone restaurant).
 *
 * Restaurant service GST is a nationwide 5% for standalone restaurants
 * (AC or non-AC), split evenly as CGST + SGST for intra-state supply.
 * No Input Tax Credit is available at this rate. The 18% slab only applies
 * to restaurants inside hotels with room tariff >= ₹7,500/night.
 *
 * Sources (verified 2026): busy.in/gst-rates/restaurant, cleartax.in/s/gst-rates
 */
export const TAX_CONFIG = {
  /** Total GST as a fraction. 5% => 0.05 */
  gstRate: 0.05,
  /** Central GST — 2.5% */
  cgstRate: 0.025,
  /** State GST (Karnataka) — 2.5% */
  sgstRate: 0.025,
  currency: "INR",
  currencySymbol: "₹",
  locale: "en-IN",
} as const;
