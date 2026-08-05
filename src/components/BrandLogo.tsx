/**
 * Smart Serve brand lockup — a serving cloche whose handle is a sparkle
 * ("serve" + "smart"), optionally stacked over the wordmark.
 *
 * Vector via react-native-svg and real Plus Jakarta Sans, so it stays crisp at
 * any size and picks up theme colors — unlike a raster logo. The launcher icon
 * and splash PNGs in `assets/brand/` are generated from the same geometry by
 * `scripts/generateBrandAssets.js`; change one, re-run the other.
 */
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { colors, fonts } from "@/theme/theme";

/** Four-point sparkle: control points at 0.24r give the pinched waist. */
function sparklePath(cx: number, cy: number, r: number): string {
  const k = r * 0.24;
  return (
    `M ${cx} ${cy - r} ` +
    `C ${cx} ${cy - k} ${cx + k} ${cy} ${cx + r} ${cy} ` +
    `C ${cx + k} ${cy} ${cx} ${cy + k} ${cx} ${cy + r} ` +
    `C ${cx} ${cy + k} ${cx - k} ${cy} ${cx - r} ${cy} ` +
    `C ${cx - k} ${cy} ${cx} ${cy - k} ${cx} ${cy - r} Z`
  );
}

// The viewBox is cropped to the mark's ink so callers size it by what they see.
const VIEW_BOX = "20 26 80 68";
const ASPECT = 80 / 68;

export function BrandMark({
  size = 96,
  color = colors.primary,
}: {
  /** Height of the mark in px; width follows the 80:68 ink ratio. */
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size * ASPECT} height={size} viewBox={VIEW_BOX}>
      <Path d="M 30 81 A 30 30 0 0 1 90 81 Z" fill={color} />
      <Rect x={20} y={85} width={80} height={9} rx={4.5} fill={color} />
      <Path d={sparklePath(60, 39, 13)} fill={color} />
      <Path d={sparklePath(86, 33, 5.5)} fill={color} />
    </Svg>
  );
}

export function BrandLogo({
  size = 96,
  color = colors.primary,
  showWordmark = true,
}: {
  size?: number;
  color?: string;
  showWordmark?: boolean;
}) {
  return (
    <View style={styles.root}>
      <BrandMark size={size} color={color} />
      {showWordmark && (
        <Text
          style={[
            styles.wordmark,
            // 0.34 sets the wordmark ~1.7x the mark's width — the lockup reads
            // as one unit; much larger and the type swamps the cloche.
            { fontSize: size * 0.34, color, marginTop: size * 0.2 },
          ]}
          allowFontScaling={false}
        >
          Smart Serve
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center" },
  wordmark: {
    fontFamily: fonts.extrabold,
    letterSpacing: 0.2,
    includeFontPadding: false,
  },
});
