/**
 * Smart Serve design tokens for React Native — the JS equivalent of the old
 * theme.css. Navy primary, white cards on a light-gray canvas, rounded
 * corners. Screens: import from here, never hardcode colors/spacing.
 */
export const colors = {
  primary: "#0047A1", // Smart Serve navy (buttons, active nav, links)
  primaryDark: "#00336F",
  primarySoft: "#e6eefb", // selected card / active nav background
  accentBlue: "#1565C0", // KDS "Start" / urgent
  danger: "#e5484d", // voids, negative deltas

  bg: "#f4f5f7", // app canvas
  floor: "#f8f9fa", // Tables floor canvas + image placeholders (soft grid backdrop)
  surface: "#ffffff", // cards
  surfaceMuted: "#f0f1f3", // image placeholder, chips
  searchBg: "#f1f3f5", // pill search field (very light gray, borderless)
  inputBorder: "#e2e8f0", // subtle input hairline (premium notes field)

  text: "#1a1a1a",
  textMuted: "#6b7280",
  textInverse: "#ffffff",

  border: "#e5e7eb",
  borderStrong: "#d1d5db",

  // The track a segmented control's active tab sits in. Deliberately darker
  // than `surfaceMuted`: the active tab IS `surface` (white), so the track has
  // to be the thing that separates them — on a white card at arm's length,
  // #f0f1f3 behind #ffffff is not a visible difference.
  track: "#e4e6ea",

  // TREND direction. Green up / red down, and never `primary` for either:
  // navy means "this control is active" everywhere else in the app, so a navy
  // pill on a KPI reads as a selected filter rather than as a number going up.
  // Soft tint + darker text, the same pairing as every other pill here.
  trendUp: "#0f7a4f",
  trendUpSoft: "#e3f6ec",
  trendDown: "#e5484d", // = danger
  trendDownSoft: "#fdecec",

  // Skeleton bones. Deliberately a touch darker than `border` and cooler than
  // `surfaceMuted`: a placeholder has to read on the white card AND on the
  // gray canvas, and every loading screen puts both behind it.
  skeleton: "#e4e7ec",

  navySoft: "#e2ebfa",
  navyText: "#0047A1",

  // Status pills on the floor grid (soft tint + darker legible text).
  mintSoft: "#e3f6ec", // Free
  mintText: "#0f7a4f",
  indigoSoft: "#e6e8fb", // Billed
  indigoText: "#3538cd",

  // KDS status system: red = active first-round order, indigo = table has an
  // additional round, green = completed.
  statusRed: "#D32F2F",
  statusRedSoft: "#fdeceb",
  statusIndigo: "#3538CD",
  statusIndigoSoft: "#e9eafc",
  statusGreen: "#2E7D32",
  statusGreenSoft: "#e4f5ec",
  statusBlue: "#1565C0", // takeaway/counter orders
  statusBlueSoft: "#e7f0fb",

  // Non-chargeable (comped) bills. Amber deliberately reads as neither the
  // navy money path nor the red of a void — an NC bill is neither a sale nor
  // a mistake, and should not be mistaken for either at a glance.
  ncAmber: "#B45309",
  ncAmberSoft: "#fdf3e3",
  ncAmberBorder: "#e8c88a",

  // OFFERS. Every control on the offers screens — buttons, chips, switches,
  // the FAB — uses the app's navy `primary`, so the feature reads as part of
  // Smart Serve rather than a bolt-on. Only the SAVING gets its own colour:
  // green, which this palette already means "free" with, and which is the one
  // number on the bill the guest is actually looking for.
  offerSoft: "#e6eefb", // tint behind offer chips/badges (= primarySoft)
  offerBorder: "#c9dcf7", // navy-tinted hairline for those surfaces
  saveGreen: "#0f7a4f", // the discount amount itself
  saveGreenSoft: "#e3f6ec",
  saveGreenBorder: "#b9e3cd",
} as const;

/** 4px spacing scale. */
export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  // A small control lifted off the surface it sits in — the active half of a
  // segmented control. Tighter and a touch stronger than `card`: the shadow
  // has a few pixels of track to fall on, so a 20px blur would just wash the
  // whole control instead of edging one tab.
  raised: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  // Soft, highly-blurred depth for floating white cards on the floor grid.
  float: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },
  // Colored "glow" for the floating primary CTA (navy at ~20% opacity).
  glow: {
    shadowColor: "#0047A1",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

/**
 * Plus Jakarta Sans — geometric sans-serif for a premium, rounded feel.
 * Loaded once in the root layout; reference these family names in styles.
 */
export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
} as const;

/** Locale / currency. */
export const currency = {
  symbol: "₹",
  code: "INR",
} as const;
