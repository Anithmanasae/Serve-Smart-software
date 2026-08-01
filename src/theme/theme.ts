/**
 * SADA POS design tokens for React Native — the JS equivalent of the old
 * theme.css. Navy primary, white cards on a light-gray canvas, rounded
 * corners. Screens: import from here, never hardcode colors/spacing.
 */
export const colors = {
  primary: "#0047A1", // SADA navy (buttons, active nav, links)
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
