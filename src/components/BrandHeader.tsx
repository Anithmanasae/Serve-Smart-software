/**
 * The app's brand bar — the Brew Brothers mark and name, in one place.
 *
 * It exists because the mark and the name were being laid out per screen, and
 * two screens had drifted apart by 2px of mark and 2pt of type. A logo that is
 * a slightly different size on every tab reads as a rendering bug rather than
 * as an identity, so the numbers live here now and every screen gets the same
 * ones.
 *
 * Sits ABOVE a screen's own title row rather than replacing it: "Brew
 * Brothers" is who the app is, "Bills" is where you are, and collapsing the
 * two would cost the screen its name.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BrandMark } from "@/components/BrandLogo";
import { colors, fonts, space } from "@/theme/theme";

export function BrandHeader({
  left,
  right,
}: {
  /** Before the mark — a back chevron on screens that push. */
  left?: ReactNode;
  /** The bar's trailing edge — a profile button, a bell, a role tag. */
  right?: ReactNode;
}) {
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        {left}
        <BrandMark size={34} />
        <Text style={styles.name} allowFontScaling={false}>
          Brew Brothers
        </Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  name: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    // Near-black, not the app's navy: the mark beside it is gold on black,
    // and navy against that reads as two brands sharing a row.
    color: colors.text,
    letterSpacing: 0.3,
  },
});
