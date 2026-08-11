/**
 * Brew Brothers brand lockup — the round gold-on-black cup badge, optionally
 * stacked over the wordmark.
 *
 * Raster, not vector: the mark is the owner's own logo rather than geometry we
 * can redraw, and its gold is a two-tone gradient no single theme colour would
 * reproduce. `assets/brand/bb-mark.png` is the cup cut out as its own disc —
 * the full badge's baked-in "BREW BROTHERS" is unreadable at the 22px the app
 * bars use, so the lockup sets the name as real Plus Jakarta Sans beside it and
 * stays crisp at every size. The launcher, splash and login assets come off the
 * same source via `scripts/generateBrewBrothersAssets.js`; change one, re-run
 * the other.
 *
 * The mark carries its own black disc, so unlike the old cloche it does NOT
 * take a colour — `color` tints the wordmark only.
 */
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, fonts } from "@/theme/theme";

const MARK = require("../../assets/brand/bb-mark.png");

export function BrandMark({ size = 96 }: { size?: number }) {
  return (
    <Image
      source={MARK}
      style={{ width: size, height: size }}
      contentFit="contain"
      // The badge is a disc on transparency; letting it fade in would flash a
      // hole in the app bar on every mount.
      transition={0}
      cachePolicy="memory-disk"
    />
  );
}

export function BrandLogo({
  size = 96,
  color = colors.text,
  showWordmark = true,
}: {
  size?: number;
  /** Wordmark colour only — the mark brings its own black and gold. */
  color?: string;
  showWordmark?: boolean;
}) {
  return (
    <View style={styles.root}>
      <BrandMark size={size} />
      {showWordmark && (
        <Text
          style={[
            styles.wordmark,
            // 0.26 of a SQUARE mark, where the old cloche's 0.34 was of a
            // wider one — the ratio that keeps the type about 1.2x the mark's
            // width, so the lockup still reads as one unit.
            { fontSize: size * 0.26, color, marginTop: size * 0.14 },
          ]}
          allowFontScaling={false}
        >
          Brew Brothers
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
