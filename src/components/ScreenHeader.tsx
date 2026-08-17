/**
 * The row that names the screen you are on — "Bills", "Tables", "Insights".
 *
 * Sits UNDER `BrandHeader`, which says who the app is. Same division of
 * labour as before: the brand bar is the identity, this is the location.
 *
 * It exists for the reason `BrandHeader` does. Seven screens each wrote their
 * own `styles.title` and they had drifted to four different sizes in two
 * different typefaces (see the `type` scale in theme.ts for why the typeface
 * drifted silently). A heading that changes size as you move between tabs
 * reads as a half-finished app, so the numbers live in one place now.
 *
 * Every structural variation the screens actually had is a prop:
 *
 *   left      a back chevron (Bill History) or a cashier avatar (Bills)
 *   right     a profile button, a "Takeaway" CTA, a "Manage" button
 *   subtitle  the muted line under the title; omit it and nothing is reserved
 *   compact   the title shares its row with something (tablet / landscape)
 *   flush     the header is already inside a padded container (a list header)
 *   children  extra blocks below the title, still inside the header's padding
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { space, typography } from "@/theme/theme";

export function ScreenHeader({
  title,
  subtitle,
  left,
  right,
  compact = false,
  flush = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  compact?: boolean;
  flush?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.wrap, flush && styles.flush]}>
      <View style={styles.row}>
        {left}
        {/* `flex: 1` on the text block, not on the title, so a long right-hand
            control shrinks the heading's box rather than pushing it off the
            edge — and so `right` stays hard against the trailing edge whether
            or not there is a subtitle. */}
        <View style={styles.text}>
          <Text style={compact ? typography.screenTitleCompact : typography.screenTitle}>
            {title}
          </Text>
          {/* A string gets the muted style; a node is passed through, for the
              screens that put a pill or an icon on that line. */}
          {typeof subtitle === "string" ? (
            <Text style={[typography.screenSubtitle, styles.subtitleGap]}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.s4,
    paddingTop: space.s2,
    paddingBottom: space.s3,
  },
  flush: { paddingHorizontal: 0 },
  row: {
    flexDirection: "row",
    // Centre, so a round control on either side (the profile button, the
    // cashier avatar) sits on the optical middle of the text block whether
    // that block is one line or two. Insights used `flex-start` and its
    // profile button hung noticeably high next to everything else.
    alignItems: "center",
    gap: space.s3,
  },
  text: { flex: 1 },
  subtitleGap: { marginTop: 2 },
});
