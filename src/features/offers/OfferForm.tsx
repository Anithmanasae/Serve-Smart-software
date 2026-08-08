/**
 * Create / edit an offer.
 *
 * The form is organised the way an owner describes a promotion out loud —
 * "thirty percent off desserts, but only on Mondays" — so it asks in that
 * order: WHAT the deal is, WHICH products get it, WHEN it runs. The schedule
 * section stays collapsed by default because most offers have no schedule at
 * all, and an "always on" promo should not have to walk past seven controls it
 * doesn't need.
 *
 * Money is typed in rupees and stored as paise (`rupeesToPaise`), same as
 * MenuItemForm. Every write goes through offersApi.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMoney, rupeesToPaise } from "@/lib/money";
import { formatMinutesIST } from "@/lib/date";
import { describeOffer } from "@/lib/offers";
import { feel, feelToggle } from "@/lib/feedback";
import { colors, fonts, radius, shadow, space } from "@/theme/theme";
import {
  DAY_LABELS,
  OFFER_KINDS,
  OFFER_KIND_LABELS,
  type Offer,
  type OfferKind,
} from "@/types/models";
import type { MenuCategoryDoc, MenuItemDoc } from "@/features/menu/useMenuData";
import { createOffer, updateOffer, type OfferInput } from "./offersApi";
import type { OfferDoc } from "./useOffersData";

interface OfferFormProps {
  visible: boolean;
  /** The offer being edited, or null to create a new one. */
  offer: OfferDoc | null;
  categories: MenuCategoryDoc[];
  items: MenuItemDoc[];
  onClose: () => void;
}

/** paise -> plain rupees string for a money input, e.g. 19900 -> "199". */
function paiseToRupeeString(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

/** One-line plain-English explanation of what each kind does, shown under the
 *  picker so the owner never has to guess which one "Couple Coffee" is. */
const KIND_HELP: Record<OfferKind, string> = {
  percent: "Takes a percentage off every covered item.",
  flat: "Takes a fixed rupee amount off each covered item.",
  bogo: "Buy a number of items, get more of them free — the cheapest ones are the free ones.",
  bundle: "Any set of covered items for one combo price.",
};

/** The common shortcuts, so the usual promo is two taps rather than a form. */
const PRESETS: ReadonlyArray<{
  label: string;
  hint: string;
  apply: (set: PresetSetters) => void;
}> = [
  {
    label: "BOGO",
    hint: "Buy 1 Get 1 Free",
    apply: (s) => {
      s.setKind("bogo");
      s.setBuyQty("1");
      s.setFreeQty("1");
      if (!s.nameTouched) s.setName("Buy 1 Get 1 Free");
    },
  },
  {
    label: "Couple Combo",
    hint: "2 items for one price",
    apply: (s) => {
      s.setKind("bundle");
      s.setBundleQty("2");
      if (!s.nameTouched) s.setName("Couple Combo");
    },
  },
  {
    label: "Monday Madness",
    hint: "% off, Mondays only",
    apply: (s) => {
      s.setKind("percent");
      s.setDays([1]);
      if (!s.nameTouched) s.setName("Monday Madness");
    },
  },
  {
    label: "Happy Hour",
    hint: "% off, 4pm–7pm",
    apply: (s) => {
      s.setKind("percent");
      s.setStartMinutes(16 * 60);
      s.setEndMinutes(19 * 60);
      s.setScheduleOpen(true);
      if (!s.nameTouched) s.setName("Happy Hour");
    },
  },
];

interface PresetSetters {
  setKind: (k: OfferKind) => void;
  setName: (n: string) => void;
  setBuyQty: (v: string) => void;
  setFreeQty: (v: string) => void;
  setBundleQty: (v: string) => void;
  setDays: (d: number[]) => void;
  setStartMinutes: (m: number | undefined) => void;
  setEndMinutes: (m: number | undefined) => void;
  setScheduleOpen: (o: boolean) => void;
  nameTouched: boolean;
}

/** Half-hour steps across the day, for the time-window pickers. */
const TIME_CHOICES = Array.from({ length: 48 }, (_, i) => i * 30);

export function OfferForm({
  visible,
  offer,
  categories,
  items,
  onClose,
}: OfferFormProps) {
  const insets = useSafeAreaInsets();

  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [kind, setKind] = useState<OfferKind>("percent");
  const [enabled, setEnabled] = useState(true);

  const [percentOff, setPercentOff] = useState("");
  const [amountOffRupees, setAmountOffRupees] = useState("");
  const [buyQty, setBuyQty] = useState("1");
  const [freeQty, setFreeQty] = useState("1");
  const [bundleQty, setBundleQty] = useState("2");
  const [bundlePriceRupees, setBundlePriceRupees] = useState("");

  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState("");

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [startMinutes, setStartMinutes] = useState<number | undefined>();
  const [endMinutes, setEndMinutes] = useState<number | undefined>();
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [maxPerOrder, setMaxPerOrder] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the sheet opens for a different offer.
  useEffect(() => {
    if (!visible) return;
    setName(offer?.name ?? "");
    setNameTouched(!!offer);
    setKind(offer?.kind ?? "percent");
    setEnabled(offer?.enabled ?? true);
    setPercentOff(offer?.percentOff !== undefined ? String(offer.percentOff) : "");
    setAmountOffRupees(
      offer?.amountOff !== undefined ? paiseToRupeeString(offer.amountOff) : ""
    );
    setBuyQty(String(offer?.buyQty ?? 1));
    setFreeQty(String(offer?.freeQty ?? 1));
    setBundleQty(String(offer?.bundleQty ?? 2));
    setBundlePriceRupees(
      offer?.bundlePrice !== undefined ? paiseToRupeeString(offer.bundlePrice) : ""
    );
    setCategoryIds(offer?.categoryIds ?? []);
    setItemIds(offer?.itemIds ?? []);
    setItemSearch("");
    setDays(offer?.days ?? []);
    setStartMinutes(offer?.startMinutes);
    setEndMinutes(offer?.endMinutes);
    setStartsOn(offer?.startsOn ?? "");
    setEndsOn(offer?.endsOn ?? "");
    setMaxPerOrder(
      offer?.maxPerOrder !== undefined ? String(offer.maxPerOrder) : ""
    );
    // Open the schedule section only when the offer actually has one, so an
    // "always on" promo stays a short form.
    setScheduleOpen(
      !!offer &&
        ((offer.days?.length ?? 0) > 0 ||
          offer.startMinutes !== undefined ||
          !!offer.startsOn ||
          !!offer.endsOn ||
          offer.maxPerOrder !== undefined)
    );
    setError(null);
    setSaving(false);
  }, [visible, offer]);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, itemSearch]);

  const coversWholeMenu = categoryIds.length === 0 && itemIds.length === 0;

  // A live preview of the terms, built from the same describeOffer() the card
  // and the receipt use — so what the owner reads here is literally what the
  // customer will see, not a second wording that can drift.
  const preview = useMemo<Offer | null>(() => {
    const draft = {
      id: "preview",
      name: name || "Untitled offer",
      kind,
      enabled,
      itemIds,
      categoryIds,
      percentOff: Number(percentOff) || 0,
      amountOff: rupeesToPaise(Number(amountOffRupees) || 0),
      buyQty: Number(buyQty) || 1,
      freeQty: Number(freeQty) || 1,
      bundleQty: Number(bundleQty) || 1,
      bundlePrice: rupeesToPaise(Number(bundlePriceRupees) || 0),
      priority: 0,
      createdAt: null,
      updatedAt: null,
    } as Offer;
    return draft;
  }, [
    name,
    kind,
    enabled,
    itemIds,
    categoryIds,
    percentOff,
    amountOffRupees,
    buyQty,
    freeQty,
    bundleQty,
    bundlePriceRupees,
  ]);

  /** The one number the chosen kind can't do without. */
  const amountValid = (() => {
    switch (kind) {
      case "percent": {
        const n = Number(percentOff);
        return percentOff.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 100;
      }
      case "flat": {
        const n = Number(amountOffRupees);
        return amountOffRupees.trim() !== "" && Number.isFinite(n) && n > 0;
      }
      case "bogo":
        return Number(buyQty) >= 1 && Number(freeQty) >= 1;
      case "bundle": {
        const p = Number(bundlePriceRupees);
        return (
          Number(bundleQty) >= 1 &&
          bundlePriceRupees.trim() !== "" &&
          Number.isFinite(p) &&
          p > 0
        );
      }
    }
  })();

  const dateValid =
    (startsOn === "" || /^\d{4}-\d{2}-\d{2}$/.test(startsOn)) &&
    (endsOn === "" || /^\d{4}-\d{2}-\d{2}$/.test(endsOn));

  const canSave = name.trim().length > 0 && amountValid && dateValid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // Only the fields this kind uses are sent. The others are left undefined
      // so offersApi strips them — switching an offer from "30% off" to BOGO
      // must not leave a stale percentOff on the document.
      const input: OfferInput = {
        name: name.trim(),
        kind,
        enabled,
        itemIds,
        categoryIds,
        priority: offer?.priority ?? 0,
        percentOff: kind === "percent" ? Math.round(Number(percentOff)) : undefined,
        amountOff:
          kind === "flat" ? rupeesToPaise(Number(amountOffRupees)) : undefined,
        buyQty: kind === "bogo" ? Math.round(Number(buyQty)) : undefined,
        freeQty: kind === "bogo" ? Math.round(Number(freeQty)) : undefined,
        bundleQty: kind === "bundle" ? Math.round(Number(bundleQty)) : undefined,
        bundlePrice:
          kind === "bundle" ? rupeesToPaise(Number(bundlePriceRupees)) : undefined,
        days: days.length > 0 ? [...days].sort((a, b) => a - b) : undefined,
        startMinutes,
        endMinutes,
        startsOn: startsOn || undefined,
        endsOn: endsOn || undefined,
        maxPerOrder:
          maxPerOrder.trim() !== "" && Number(maxPerOrder) > 0
            ? Math.round(Number(maxPerOrder))
            : undefined,
      };

      if (offer) await updateOffer(offer.id, input);
      else await createOffer(input);
      feel.success();
      onClose();
    } catch (e) {
      feel.error();
      setError(e instanceof Error ? e.message : "Failed to save the offer.");
      setSaving(false);
    }
  };

  const presetSetters: PresetSetters = {
    setKind,
    setName,
    setBuyQty,
    setFreeQty,
    setBundleQty,
    setDays,
    setStartMinutes,
    setEndMinutes,
    setScheduleOpen,
    nameTouched,
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s3 }]}>
          <View style={styles.dragHandle} />

          <View style={styles.header}>
            <Text style={styles.title}>{offer ? "Edit Offer" : "New Offer"}</Text>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
              onPress={onClose}
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Live preview ───────────────────────────────────────────── */}
            {preview ? (
              <View style={styles.preview}>
                <Text style={styles.previewLabel}>PREVIEW</Text>
                <Text style={styles.previewName} numberOfLines={1}>
                  {name.trim() || "Untitled offer"}
                </Text>
                <Text style={styles.previewTerms}>
                  {describeOffer(preview, formatMoney)}
                </Text>
                <Text style={styles.previewScope} numberOfLines={2}>
                  {coversWholeMenu
                    ? "on everything"
                    : `on ${categoryIds.length + itemIds.length} selected ${
                        categoryIds.length + itemIds.length === 1
                          ? "group"
                          : "groups"
                      }`}
                  {days.length > 0 && days.length < 7
                    ? ` · ${days
                        .slice()
                        .sort((a, b) => a - b)
                        .map((d) => DAY_LABELS[d])
                        .join(", ")}`
                    : ""}
                  {startMinutes !== undefined && endMinutes !== undefined
                    ? ` · ${formatMinutesIST(startMinutes)}–${formatMinutesIST(
                        endMinutes
                      )}`
                    : ""}
                </Text>
              </View>
            ) : null}

            {/* ── Presets ────────────────────────────────────────────────── */}
            {!offer ? (
              <>
                <Text style={styles.sectionLabel}>Start from</Text>
                <View style={styles.presetRow}>
                  {PRESETS.map((p) => (
                    <Pressable
                      key={p.label}
                      style={({ pressed }) => [
                        styles.preset,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => {
                        feel.select();
                        p.apply(presetSetters);
                      }}
                    >
                      <Text style={styles.presetLabel}>{p.label}</Text>
                      <Text style={styles.presetHint}>{p.hint}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {/* ── 1. What ────────────────────────────────────────────────── */}
            <Text style={styles.sectionLabel}>Offer name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(t) => {
                setName(t);
                setNameTouched(true);
              }}
              placeholder="e.g. Monday Madness"
              placeholderTextColor={colors.textMuted}
              maxLength={60}
            />
            <Text style={styles.help}>
              This is what prints on the customer's bill.
            </Text>

            <Text style={styles.sectionLabel}>Discount type</Text>
            <View style={styles.kindRow}>
              {OFFER_KINDS.map((k) => {
                const active = k === kind;
                return (
                  <Pressable
                    key={k}
                    style={({ pressed }) => [
                      styles.kindChip,
                      active && styles.kindChipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => {
                      if (kind !== k) feel.select();
                      setKind(k);
                    }}
                  >
                    <Text
                      style={[
                        styles.kindChipText,
                        active && styles.kindChipTextActive,
                      ]}
                    >
                      {OFFER_KIND_LABELS[k]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.help}>{KIND_HELP[kind]}</Text>

            {/* Kind-specific numbers */}
            {kind === "percent" ? (
              <>
                <Text style={styles.sectionLabel}>Percentage off</Text>
                <View style={styles.suffixField}>
                  <TextInput
                    style={styles.suffixInput}
                    value={percentOff}
                    onChangeText={setPercentOff}
                    placeholder="30"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={3}
                  />
                  <Text style={styles.suffix}>%</Text>
                </View>
              </>
            ) : null}

            {kind === "flat" ? (
              <>
                <Text style={styles.sectionLabel}>Amount off each item</Text>
                <View style={styles.suffixField}>
                  <Text style={styles.prefix}>₹</Text>
                  <TextInput
                    style={styles.suffixInput}
                    value={amountOffRupees}
                    onChangeText={setAmountOffRupees}
                    placeholder="30"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Text style={styles.help}>
                  Capped at the item's own price — it can make something free,
                  never negative.
                </Text>
              </>
            ) : null}

            {kind === "bogo" ? (
              <>
                <Text style={styles.sectionLabel}>The deal</Text>
                <View style={styles.pairRow}>
                  <View style={styles.pairCol}>
                    <Text style={styles.pairLabel}>Buy</Text>
                    <TextInput
                      style={styles.input}
                      value={buyQty}
                      onChangeText={setBuyQty}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                  </View>
                  <View style={styles.pairCol}>
                    <Text style={styles.pairLabel}>Get free</Text>
                    <TextInput
                      style={styles.input}
                      value={freeQty}
                      onChangeText={setFreeQty}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                  </View>
                </View>
                <Text style={styles.help}>
                  Counts across the whole order — three covered items on two
                  separate lines still earn the free one. The cheapest items are
                  the free ones.
                </Text>
              </>
            ) : null}

            {kind === "bundle" ? (
              <>
                <Text style={styles.sectionLabel}>The combo</Text>
                <View style={styles.pairRow}>
                  <View style={styles.pairCol}>
                    <Text style={styles.pairLabel}>How many</Text>
                    <TextInput
                      style={styles.input}
                      value={bundleQty}
                      onChangeText={setBundleQty}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                  </View>
                  <View style={styles.pairCol}>
                    <Text style={styles.pairLabel}>For a total of (₹)</Text>
                    <TextInput
                      style={styles.input}
                      value={bundlePriceRupees}
                      onChangeText={setBundlePriceRupees}
                      placeholder="199"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
                <Text style={styles.help}>
                  The most expensive covered items fill the combo first, so the
                  customer always gets the better deal.
                </Text>
              </>
            ) : null}

            {/* ── 2. Which products ──────────────────────────────────────── */}
            <View style={styles.sectionDivider} />
            <Text style={styles.sectionHeading}>Which products?</Text>
            <Text style={styles.help}>
              Pick nothing to cover the entire menu. Choosing a category is the
              durable option — new items added to it join the offer on their own.
            </Text>

            <Text style={styles.sectionLabel}>Categories</Text>
            <View style={styles.chips}>
              {categories.map((c) => {
                const active = categoryIds.includes(c.id);
                return (
                  <Pressable
                    key={c.id}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => {
                      // Scope chips are checkboxes, so they say which way the
                      // tick went rather than just that something happened.
                      feelToggle(!categoryIds.includes(c.id));
                      setCategoryIds(toggle(categoryIds, c.id));
                    }}
                  >
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                    >
                      {c.name}
                    </Text>
                  </Pressable>
                );
              })}
              {categories.length === 0 ? (
                <Text style={styles.help}>No categories yet.</Text>
              ) : null}
            </View>

            <Text style={styles.sectionLabel}>
              Individual items{itemIds.length > 0 ? ` (${itemIds.length})` : ""}
            </Text>
            <TextInput
              style={styles.input}
              value={itemSearch}
              onChangeText={setItemSearch}
              placeholder="Search items…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
            <View style={styles.chips}>
              {filteredItems.slice(0, 40).map((it) => {
                const active = itemIds.includes(it.id);
                return (
                  <Pressable
                    key={it.id}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => {
                      feelToggle(!itemIds.includes(it.id));
                      setItemIds(toggle(itemIds, it.id));
                    }}
                  >
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                    >
                      {it.name}
                    </Text>
                  </Pressable>
                );
              })}
              {filteredItems.length > 40 ? (
                <Text style={styles.help}>
                  Showing the first 40 — search to narrow it down.
                </Text>
              ) : null}
            </View>

            {/* ── 3. When ───────────────────────────────────────────────── */}
            <View style={styles.sectionDivider} />
            <Pressable
              style={({ pressed }) => [
                styles.scheduleToggle,
                pressed && styles.pressed,
              ]}
              onPress={() => {
                feel.tap();
                setScheduleOpen((o) => !o);
              }}
            >
              <View style={styles.scheduleToggleText}>
                <Text style={styles.sectionHeading}>When does it run?</Text>
                <Text style={styles.help}>
                  {scheduleOpen
                    ? "Leave anything blank to keep it unrestricted."
                    : "Always on. Tap to limit it to certain days, hours or dates."}
                </Text>
              </View>
              <Text style={styles.scheduleChevron}>
                {scheduleOpen ? "▴" : "▾"}
              </Text>
            </Pressable>

            {scheduleOpen ? (
              <>
                <Text style={styles.sectionLabel}>Days of the week</Text>
                <View style={styles.dayRow}>
                  {DAY_LABELS.map((label, index) => {
                    const active = days.includes(index);
                    return (
                      <Pressable
                        key={label}
                        style={({ pressed }) => [
                          styles.dayBtn,
                          active && styles.dayBtnActive,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => {
                          feelToggle(!days.includes(index));
                          setDays(toggle(days, index));
                        }}
                      >
                        <Text
                          style={[
                            styles.dayBtnText,
                            active && styles.dayBtnTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.help}>
                  {days.length === 0
                    ? "Every day."
                    : `Only ${days
                        .slice()
                        .sort((a, b) => a - b)
                        .map((d) => DAY_LABELS[d])
                        .join(", ")}.`}
                </Text>

                <Text style={styles.sectionLabel}>Hours</Text>
                <View style={styles.pairRow}>
                  <View style={styles.pairCol}>
                    <Text style={styles.pairLabel}>From</Text>
                    <TimePicker
                      value={startMinutes}
                      onChange={setStartMinutes}
                    />
                  </View>
                  <View style={styles.pairCol}>
                    <Text style={styles.pairLabel}>To</Text>
                    <TimePicker value={endMinutes} onChange={setEndMinutes} />
                  </View>
                </View>
                {startMinutes !== undefined && endMinutes !== undefined ? (
                  <Pressable
                    onPress={() => {
                      setStartMinutes(undefined);
                      setEndMinutes(undefined);
                    }}
                  >
                    <Text style={styles.clearLink}>Clear hours (run all day)</Text>
                  </Pressable>
                ) : null}

                <Text style={styles.sectionLabel}>Campaign dates</Text>
                <View style={styles.pairRow}>
                  <View style={styles.pairCol}>
                    <Text style={styles.pairLabel}>Starts (yyyy-mm-dd)</Text>
                    <TextInput
                      style={styles.input}
                      value={startsOn}
                      onChangeText={setStartsOn}
                      placeholder="optional"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      maxLength={10}
                    />
                  </View>
                  <View style={styles.pairCol}>
                    <Text style={styles.pairLabel}>Ends (yyyy-mm-dd)</Text>
                    <TextInput
                      style={styles.input}
                      value={endsOn}
                      onChangeText={setEndsOn}
                      placeholder="optional"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      maxLength={10}
                    />
                  </View>
                </View>
                {!dateValid ? (
                  <Text style={styles.error}>Dates must look like 2026-08-15.</Text>
                ) : null}

                {kind === "bogo" || kind === "bundle" ? (
                  <>
                    <Text style={styles.sectionLabel}>Limit per order</Text>
                    <TextInput
                      style={styles.input}
                      value={maxPerOrder}
                      onChangeText={setMaxPerOrder}
                      placeholder="No limit"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                    <Text style={styles.help}>
                      How many times one bill may claim this. Blank = unlimited.
                    </Text>
                  </>
                ) : null}
              </>
            ) : null}

            {/* ── Live switch ───────────────────────────────────────────── */}
            <View style={styles.sectionDivider} />
            <View style={styles.enabledRow}>
              <View style={styles.enabledText}>
                <Text style={styles.sectionHeading}>Active</Text>
                <Text style={styles.help}>
                  {enabled
                    ? "Applies to new orders as soon as you save."
                    : "Saved but not applied to anything."}
                </Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={(v) => {
                  feelToggle(v);
                  setEnabled(v);
                }}
                trackColor={{
                  true: colors.primary,
                  false: colors.borderStrong,
                }}
                thumbColor={colors.surface}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                pressed && styles.pressed,
              ]}
              onPress={onClose}
              disabled={saving}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canSave && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
              onPress={handleSave}
              disabled={!canSave}
            >
              {saving ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.btnPrimaryText}>
                  {name.trim().length === 0
                    ? "Name your offer"
                    : !amountValid
                      ? "Set the discount"
                      : offer
                        ? "Save Changes"
                        : "Create Offer"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** A horizontal half-hour scroller — no date-picker dependency, and the whole
 *  trading day is reachable with a flick. */
function TimePicker({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (m: number) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.timeRow}
    >
      {TIME_CHOICES.map((m) => {
        const active = value === m;
        return (
          <Pressable
            key={m}
            style={({ pressed }) => [
              styles.timeChip,
              active && styles.timeChipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => onChange(m)}
          >
            <Text
              style={[styles.timeChipText, active && styles.timeChipTextActive]}
            >
              {formatMinutesIST(m)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: space.s3,
    maxHeight: "94%",
  },
  dragHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: space.s2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s4,
    paddingBottom: space.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    color: colors.text,
    letterSpacing: -0.3,
  },
  close: { fontSize: 18, color: colors.textMuted },
  scroll: { flexGrow: 0 },
  scrollContent: {
    padding: space.s4,
    gap: space.s2,
  },

  // Preview
  preview: {
    backgroundColor: colors.offerSoft,
    borderWidth: 1,
    borderColor: colors.offerBorder,
    borderRadius: radius.lg,
    padding: space.s4,
    gap: space.s1,
    marginBottom: space.s2,
  },
  previewLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.primary,
  },
  previewName: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    color: colors.text,
    letterSpacing: -0.3,
  },
  previewTerms: {
    fontFamily: fonts.bold,
    fontSize: 16,
    // Green like the card's terms and the saving on the bill — the same colour
    // means the same thing everywhere: this is what comes off.
    color: colors.saveGreen,
  },
  previewScope: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
  },

  // Presets
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s2,
  },
  preset: {
    flexGrow: 1,
    flexBasis: "47%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    gap: 2,
    ...shadow.card,
  },
  presetLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.text,
  },
  presetHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textMuted,
  },

  sectionHeading: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    color: colors.text,
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: space.s3,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: space.s5,
  },
  help: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.text,
  },
  suffixField: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.s4,
  },
  suffixInput: {
    flex: 1,
    paddingVertical: space.s3,
    fontFamily: fonts.extrabold,
    fontSize: 24,
    color: colors.text,
  },
  suffix: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    color: colors.textMuted,
  },
  prefix: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    color: colors.textMuted,
    marginRight: space.s2,
  },
  kindRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s2,
  },
  kindChip: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  kindChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  kindChipText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.text,
  },
  kindChipTextActive: { color: colors.textInverse },

  pairRow: {
    flexDirection: "row",
    gap: space.s3,
  },
  pairCol: { flex: 1, gap: space.s1 },
  pairLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.textMuted,
  },

  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s2,
  },
  chip: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.text,
  },
  chipTextActive: { color: colors.textInverse },

  scheduleToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    paddingTop: space.s4,
  },
  scheduleToggleText: { flex: 1, gap: 2 },
  scheduleChevron: {
    fontSize: 18,
    color: colors.textMuted,
  },
  dayRow: {
    flexDirection: "row",
    gap: space.s1,
  },
  dayBtn: {
    flex: 1,
    paddingVertical: space.s3,
    borderRadius: radius.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dayBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayBtnText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.text,
  },
  dayBtnTextActive: { color: colors.textInverse },

  timeRow: {
    gap: space.s2,
    paddingVertical: space.s1,
  },
  timeChip: {
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  timeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  timeChipText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.text,
  },
  timeChipTextActive: { color: colors.textInverse },
  clearLink: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primary,
    paddingTop: space.s1,
  },

  enabledRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s3,
    paddingTop: space.s4,
  },
  enabledText: { flex: 1, gap: 2 },

  error: {
    fontFamily: fonts.medium,
    color: colors.danger,
    fontSize: 13,
    marginTop: space.s2,
  },
  footer: {
    flexDirection: "row",
    gap: space.s3,
    paddingHorizontal: space.s4,
    paddingTop: space.s3,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    height: 50,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    color: colors.textInverse,
    fontFamily: fonts.extrabold,
    fontSize: 15,
  },
  btnGhost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  btnGhostText: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  btnDisabled: { opacity: 0.5 },
});
