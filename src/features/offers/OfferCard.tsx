/**
 * One offer in the management list.
 *
 * The card is built around a single question the owner asks at a glance: is
 * this running right now? That is `isOfferLive()` — enabled AND inside its
 * day/time/date window — and it drives the whole card's treatment, because
 * "enabled but it's Tuesday and this is a Monday promo" is exactly the state
 * an owner misreads when the UI only shows a toggle.
 */
import { memo } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { dayKey, formatMinutesIST } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { describeOffer, isOfferLive } from "@/lib/offers";
import { PressableScale } from "@/components/PressableScale";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import { DAY_LABELS, OFFER_KIND_LABELS } from "@/types/models";
import type { OfferDoc } from "./useOffersData";

interface OfferCardProps {
  offer: OfferDoc;
  /** How many products it covers, resolved against the live menu. */
  productCount: number;
  /** True when the scope is "everything on the menu". */
  coversWholeMenu: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}

/** Why an enabled offer still isn't running — the owner's most likely
 *  confusion, answered on the card instead of in a support call. */
function pausedReason(offer: OfferDoc, now: Date): string {
  if (!offer.enabled) return "Paused";
  // dayKey, not toISOString: the campaign window is in IST business days, and
  // a UTC date would report "Ended" for five and a half hours of every last day.
  const today = dayKey(now);
  if (offer.endsOn && offer.endsOn < today) return "Ended";
  if (offer.startsOn && offer.startsOn > today) return "Starts later";
  if (offer.days && offer.days.length > 0) return "Not today";
  return "Outside hours";
}

function OfferCardImpl({
  offer,
  productCount,
  coversWholeMenu,
  onEdit,
  onToggle,
  onDelete,
}: OfferCardProps) {
  const now = new Date();
  const live = isOfferLive(offer, now);
  const scheduled = offer.enabled && !live;

  const days = offer.days ?? [];
  const hasDayFilter = days.length > 0 && days.length < 7;
  const hasTimeWindow =
    offer.startMinutes !== undefined &&
    offer.endMinutes !== undefined &&
    offer.startMinutes !== offer.endMinutes;

  return (
    <View style={[styles.card, live && styles.cardLive]}>
      {/* A live offer gets a violet spine — findable while scrolling fast. */}
      <View style={[styles.spine, live && styles.spineLive]} />

      <View style={styles.inner}>
        <View style={styles.headRow}>
          <View style={styles.headText}>
            <Text style={styles.name} numberOfLines={1}>
              {offer.name}
            </Text>
            <Text style={styles.terms} numberOfLines={1}>
              {describeOffer(offer, formatMoney)}
            </Text>
          </View>

          <Switch
            value={offer.enabled}
            onValueChange={onToggle}
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
            thumbColor={colors.surface}
          />
        </View>

        {/* Status + kind */}
        <View style={styles.badgeRow}>
          {live ? (
            <View style={[styles.badge, styles.badgeLive]}>
              <View style={styles.liveDot} />
              <Text style={styles.badgeLiveText}>LIVE NOW</Text>
            </View>
          ) : (
            <View style={[styles.badge, styles.badgeIdle]}>
              <Text style={styles.badgeIdleText}>
                {pausedReason(offer, now).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={[styles.badge, styles.badgeKind]}>
            <Text style={styles.badgeKindText}>
              {OFFER_KIND_LABELS[offer.kind]}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Scope */}
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Applies to</Text>
          <Text style={styles.metaValue} numberOfLines={1}>
            {coversWholeMenu
              ? "Everything on the menu"
              : `${productCount} ${productCount === 1 ? "product" : "products"}`}
          </Text>
        </View>

        {/* Day pills — the whole week is always drawn so "only Mondays" reads
            as a shape, not as a sentence the owner has to parse. */}
        {hasDayFilter ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Days</Text>
            <View style={styles.dayPills}>
              {DAY_LABELS.map((label, index) => {
                const on = days.includes(index);
                return (
                  <View
                    key={label}
                    style={[styles.dayPill, on && styles.dayPillOn]}
                  >
                    <Text
                      style={[styles.dayPillText, on && styles.dayPillTextOn]}
                    >
                      {label.charAt(0)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {hasTimeWindow ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Hours</Text>
            <Text style={styles.metaValue}>
              {formatMinutesIST(offer.startMinutes!)} –{" "}
              {formatMinutesIST(offer.endMinutes!)}
            </Text>
          </View>
        ) : null}

        {offer.startsOn || offer.endsOn ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Runs</Text>
            <Text style={styles.metaValue}>
              {offer.startsOn ?? "any time"} → {offer.endsOn ?? "no end date"}
            </Text>
          </View>
        ) : null}

        {/* The flex lives on these wrappers, not on the PressableScale: it
            forwards `style` to its inner view, so `flex: 1` there would size
            the painted pill while the tappable Pressable stayed content-width. */}
        <View style={styles.actions}>
          <View style={styles.actionSlot}>
            <PressableScale
              activeScale={0.96}
              style={[styles.actionBtn, styles.editBtn]}
              onPress={onEdit}
            >
              <Text style={styles.editBtnText}>Edit</Text>
            </PressableScale>
          </View>
          <View style={styles.actionSlot}>
            <PressableScale
              activeScale={0.96}
              // Destructive: it lands harder than Edit next to it, so the two
              // are never confused by touch alone.
              haptic="warn"
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={onDelete}
            >
              <Text style={styles.deleteBtnText}>Delete</Text>
            </PressableScale>
          </View>
        </View>
      </View>

      {scheduled ? (
        <Text style={styles.scheduleHint}>
          Switched on, but not running right now — it will apply automatically
          when its schedule comes round.
        </Text>
      ) : null}
    </View>
  );
}

export const OfferCard = memo(OfferCardImpl);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    ...shadow.float,
  },
  cardLive: {
    ...shadow.card,
    borderWidth: 1,
    borderColor: colors.offerBorder,
  },
  spine: {
    height: 4,
    backgroundColor: colors.border,
  },
  spineLive: {
    backgroundColor: colors.primary,
  },
  inner: {
    padding: space.s4,
    gap: space.s3,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s3,
  },
  headText: {
    flex: 1,
    gap: space.s1,
  },
  name: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    color: colors.text,
    letterSpacing: -0.2,
  },
  terms: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.saveGreen,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s2,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    paddingHorizontal: space.s3,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
  },
  badgeLive: {
    backgroundColor: colors.mintSoft,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.mintText,
  },
  badgeLiveText: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.mintText,
  },
  badgeIdle: {
    backgroundColor: colors.surfaceMuted,
  },
  badgeIdleText: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  badgeKind: {
    backgroundColor: colors.offerSoft,
  },
  badgeKindText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  metaLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textMuted,
  },
  metaValue: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.text,
    textAlign: "right",
  },
  dayPills: {
    flexDirection: "row",
    gap: 3,
  },
  dayPill: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  dayPillOn: {
    backgroundColor: colors.primary,
  },
  dayPillText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textMuted,
  },
  dayPillTextOn: {
    color: colors.textInverse,
  },
  actions: {
    flexDirection: "row",
    gap: space.s2,
    paddingTop: space.s1,
  },
  actionSlot: {
    flex: 1,
  },
  actionBtn: {
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtn: {
    backgroundColor: colors.primarySoft,
  },
  editBtnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  deleteBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deleteBtnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.danger,
  },
  scheduleHint: {
    paddingHorizontal: space.s4,
    paddingBottom: space.s4,
    marginTop: -space.s1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
});
