/**
 * Offers management — the owner's promotions list.
 *
 * All data is live (useOffers / useMenuData) and every write goes through
 * offersApi. Nothing on this screen computes a discount; it edits the RULES,
 * and `src/lib/offers.ts` applies them when an order is priced.
 *
 * The header counts LIVE offers rather than enabled ones, because those are
 * different numbers whenever a schedule is involved and the live count is the
 * one that explains what the waiter's screen is doing right now.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { isOfferLive } from "@/lib/offers";
import { feel, feelToggle } from "@/lib/feedback";
import { PressableScale } from "@/components/PressableScale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import { useMenuCategories, useMenuItems } from "@/features/menu/useMenuData";
import { deleteOffer, setOfferEnabled } from "./offersApi";
import { useOffers, type OfferDoc } from "./useOffersData";
import { OfferCard } from "./OfferCard";
import { OfferForm } from "./OfferForm";

export function OffersScreen() {
  const insets = useSafeAreaInsets();
  const offersState = useOffers();
  const categoriesState = useMenuCategories();
  const itemsState = useMenuItems();

  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<OfferDoc | null>(null);

  const liveCount = useMemo(() => {
    const now = new Date();
    return offersState.data.filter((o) => isOfferLive(o, now)).length;
  }, [offersState.data]);

  // categoryId -> how many menu items sit in it, so a card can say "12
  // products" for a category-scoped offer instead of "1 category".
  const itemsPerCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of itemsState.data) {
      counts.set(it.categoryId, (counts.get(it.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [itemsState.data]);

  const productCountFor = (offer: OfferDoc): number => {
    const direct = new Set(offer.itemIds ?? []);
    let total = direct.size;
    for (const categoryId of offer.categoryIds ?? []) {
      total += itemsPerCategory.get(categoryId) ?? 0;
    }
    return total;
  };

  const openNew = () => {
    feel.press(); // the form takes over the screen
    setEditing(null);
    setFormVisible(true);
  };

  const openEdit = (offer: OfferDoc) => {
    feel.press();
    setEditing(offer);
    setFormVisible(true);
  };

  const handleToggle = (offer: OfferDoc, enabled: boolean) => {
    // On and off are deliberately different pulses: pausing a promotion and
    // starting one are opposite acts, and the switch is small enough that the
    // hand often gets there before the eye does.
    feelToggle(enabled);
    setOfferEnabled(offer.id, enabled).catch((e) => {
      feel.error();
      Alert.alert(
        "Couldn't update the offer",
        e instanceof Error ? e.message : String(e)
      );
    });
  };

  /**
   * Deleting is destructive and irreversible, so the confirm spells out what
   * it does NOT do: bills already priced under the offer keep their discount,
   * because the name and amount were snapshotted onto those order lines. An
   * owner who only wants to pause it is pointed at the switch instead.
   */
  const handleDelete = (offer: OfferDoc) => {
    // The caution is played by the Delete button on touch-down, not here.
    Alert.alert(
      `Delete "${offer.name}"?`,
      "It stops applying to new orders straight away. Bills that already used " +
        "it keep their discount and your reports stay accurate.\n\n" +
        "To pause it instead, use the switch on the card — that keeps the " +
        "settings so you can switch it back on later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            deleteOffer(offer.id)
              .then(() => feel.heavy()) // gone, and it should land like it
              .catch((e) => {
                feel.error();
                Alert.alert(
                  "Couldn't delete the offer",
                  e instanceof Error ? e.message : String(e)
                );
              }),
        },
      ]
    );
  };

  const loading = offersState.loading || itemsState.loading;
  const error = offersState.error ?? categoriesState.error ?? itemsState.error;
  const total = offersState.data.length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <PressableScale
          activeScale={0.92}
          hitSlop={8}
          haptic="dismiss"
          style={styles.backBtn}
          onPress={() => router.back()}
        >
          <Feather name="chevron-left" size={22} color={colors.text} />
        </PressableScale>
        <Text style={styles.topBarTitle}>Offers</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={offersState.data}
        keyExtractor={(o) => o.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: space.s3 }} />}
        ListHeaderComponent={
          // `flush`: this header is the list's own header, already inside the
          // list's horizontal padding, so it must not add its own.
          <ScreenHeader
            flush
            title="Offers & Discounts"
            subtitle="Set up a deal once and it prices itself onto every order — automatically, on the days and hours you choose."
          >
            {total > 0 ? (
              <View style={styles.statRow}>
                <View style={[styles.stat, styles.statLive]}>
                  <Text style={styles.statValueLive}>{liveCount}</Text>
                  <Text style={styles.statLabelLive}>running now</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{total - liveCount}</Text>
                  <Text style={styles.statLabel}>paused or scheduled</Text>
                </View>
              </View>
            ) : null}
          </ScreenHeader>
        }
        renderItem={({ item }) => (
          <OfferCard
            offer={item}
            productCount={productCountFor(item)}
            coversWholeMenu={
              (item.itemIds?.length ?? 0) === 0 &&
              (item.categoryIds?.length ?? 0) === 0
            }
            onEdit={() => openEdit(item)}
            onToggle={(enabled) => handleToggle(item, enabled)}
            onDelete={() => handleDelete(item)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.errorTitle}>Couldn't load offers.</Text>
              <Text style={styles.emptySub}>{error.message}</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyBadge}>
                <Feather name="tag" size={26} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No offers yet</Text>
              <Text style={styles.emptySub}>
                Create your first deal — Buy One Get One, a combo price, or a
                percentage off on the slow days of the week.
              </Text>
            </View>
          )
        }
      />

      {/* Floating CTA.
          The positioning lives on this wrapper, NOT on the PressableScale:
          that component forwards `style` to its inner Animated.View, so an
          absolutely-positioned style would paint the button in the right place
          while leaving the actual Pressable collapsed to zero height in normal
          flow — visible, and untappable. */}
      <View style={[styles.fabWrap, { bottom: insets.bottom + space.s5 }]}>
        <PressableScale
          activeScale={0.97}
          haptic={false} // openNew plays the press itself
          style={styles.fab}
          onPress={openNew}
        >
          <Feather name="plus" size={20} color={colors.textInverse} />
          <Text style={styles.fabText}>New Offer</Text>
        </PressableScale>
      </View>

      <OfferForm
        visible={formVisible}
        offer={editing}
        categories={categoriesState.data}
        items={itemsState.data}
        onClose={() => setFormVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.text,
  },
  listContent: {
    paddingHorizontal: space.s4,
  },
  statRow: {
    flexDirection: "row",
    gap: space.s3,
    paddingTop: space.s2,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
    gap: 2,
    ...shadow.card,
  },
  statLive: {
    backgroundColor: colors.offerSoft,
    borderWidth: 1,
    borderColor: colors.offerBorder,
  },
  statValue: {
    fontFamily: fonts.extrabold,
    fontSize: 24,
    color: colors.text,
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.textMuted,
  },
  statValueLive: {
    fontFamily: fonts.extrabold,
    fontSize: 24,
    color: colors.primary,
  },
  statLabelLive: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.primary,
  },
  center: {
    paddingVertical: space.s6 * 2,
    alignItems: "center",
    gap: space.s2,
  },
  empty: {
    alignItems: "center",
    paddingVertical: space.s6 * 2,
    paddingHorizontal: space.s5,
    gap: space.s3,
  },
  emptyBadge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.offerSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    color: colors.text,
  },
  emptySub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: "center",
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.danger,
  },
  fabWrap: {
    position: "absolute",
    left: space.s4,
    right: space.s4,
  },
  fab: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s2,
    backgroundColor: colors.primary,
    paddingVertical: space.s4,
    borderRadius: radius.pill,
    // The same navy glow the waiter's cart bar uses, rather than a bespoke one.
    ...shadow.glow,
  },
  fabText: {
    color: colors.textInverse,
    fontFamily: fonts.extrabold,
    fontSize: 16,
  },
});
