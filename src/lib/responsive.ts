/**
 * Phone vs. tablet layout adaptation.
 *
 * Two rules keep this honest:
 *
 * - **Size is measured on the SHORTER edge**, matching Android's own `sw600dp`
 *   qualifier. A phone held sideways is still a phone; a tablet stays a tablet
 *   through a rotation. Keying off `width` alone would flip the whole layout
 *   every time someone turns the device, which is exactly the bug this avoids.
 * - **Everything comes from `useWindowDimensions`**, which re-renders on
 *   rotation, never from `Dimensions.get()` — that is read once and then lies
 *   for the rest of the session.
 *
 * Screens branch on `isTablet` for structure (a docked pane vs. a bottom
 * sheet) and use the raw `width` for sizing within that structure, so portrait
 * and landscape are the same layout breathing, not two code paths.
 */
import { useWindowDimensions } from "react-native";

/** Android's sw600dp cut-off: ~7" and up is a tablet. */
const TABLET_MIN_EDGE = 600;

export interface Responsive {
  width: number;
  height: number;
  /** Shorter edge ≥ 600dp — stable across rotation. */
  isTablet: boolean;
  isLandscape: boolean;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isTablet: Math.min(width, height) >= TABLET_MIN_EDGE,
    isLandscape: width > height,
  };
}

/**
 * How many cards of at least `minCardWidth` fit across `available` px.
 *
 * Always returns at least 2 — a one-card row reads as a broken list rather
 * than a grid, and on the narrowest tablet pane two snug cards beat one wide
 * one.
 */
export function gridColumns(
  available: number,
  minCardWidth = 200,
  max = 6
): number {
  if (!Number.isFinite(available) || available <= 0) return 2;
  return Math.min(max, Math.max(2, Math.floor(available / minCardWidth)));
}
