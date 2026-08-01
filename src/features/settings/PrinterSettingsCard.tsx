/**
 * Account tab card: Bluetooth thermal printer setup.
 *
 * Paper width (58/80mm), the paired-device picker, and a test print. All
 * Bluetooth work goes through `printerService`, which no-ops gracefully in
 * Expo Go (`isPrintingAvailable()` false → an explainer instead of a crash).
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radius, shadow, space } from "@/theme/theme";
import { encodeTestTicket, type PaperWidth } from "@/lib/printer/escpos";
import {
  disconnectPrinter,
  getPaperWidth,
  getSavedPrinter,
  isPrintingAvailable,
  listPairedDevices,
  printToDevice,
  savePrinter,
  setPaperWidth,
  type PrinterDevice,
} from "@/lib/printer/printerService";

const PAPER_WIDTHS: PaperWidth[] = [58, 80];

export function PrinterSettingsCard() {
  const available = isPrintingAvailable();

  const [paper, setPaper] = useState<PaperWidth>(58);
  const [saved, setSaved] = useState<PrinterDevice | null>(null);
  const [devices, setDevices] = useState<PrinterDevice[] | null>(null);
  const [busy, setBusy] = useState<null | "list" | "test">(null);

  // Hydrate persisted choices once.
  useEffect(() => {
    getPaperWidth().then(setPaper).catch(() => {});
    getSavedPrinter().then(setSaved).catch(() => {});
  }, []);

  function onPickPaper(width: PaperWidth) {
    setPaper(width);
    setPaperWidth(width).catch((e) =>
      console.warn("[printer] failed to persist paper width:", e)
    );
  }

  async function onListDevices() {
    setBusy("list");
    try {
      setDevices(await listPairedDevices());
    } catch (e) {
      Alert.alert(
        "Couldn't list printers",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(null);
    }
  }

  async function onSelectDevice(device: PrinterDevice) {
    // Switching printers: drop the old socket so the new one connects cleanly.
    if (saved && saved.address !== device.address) {
      await disconnectPrinter(saved);
    }
    setSaved(device);
    try {
      await savePrinter(device);
    } catch (e) {
      Alert.alert(
        "Couldn't save printer",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  async function onTestPrint() {
    if (!saved) {
      Alert.alert("No printer selected", "Pick a paired printer first.");
      return;
    }
    setBusy("test");
    try {
      await printToDevice(saved, encodeTestTicket(paper).bytes);
      Alert.alert("Test sent", `Check ${saved.name} for the test slip.`);
    } catch (e) {
      Alert.alert("Test failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Printer Settings</Text>

      {!available ? (
        <Text style={styles.hint}>
          Printing requires the installed app. Bluetooth isn't available in
          Expo Go — build and install the APK to set up the printer.
        </Text>
      ) : (
        <>
          {/* Paper width */}
          <Text style={styles.label}>Paper width</Text>
          <View style={styles.segmentRow}>
            {PAPER_WIDTHS.map((w) => {
              const active = paper === w;
              return (
                <Pressable
                  key={w}
                  style={({ pressed }) => [
                    styles.segment,
                    active && styles.segmentActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => onPickPaper(w)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      active && styles.segmentTextActive,
                    ]}
                  >
                    {w} mm
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Selected printer + paired list */}
          <Text style={styles.label}>Printer</Text>
          <Text style={styles.hint}>
            {saved
              ? `Selected: ${saved.name}`
              : "Pair the printer in Android Bluetooth settings, then pick it here."}
          </Text>

          {devices !== null && devices.length === 0 && (
            <Text style={styles.hint}>No paired devices found.</Text>
          )}
          {devices?.map((d) => {
            const active = saved?.address === d.address;
            return (
              <Pressable
                key={d.address}
                style={({ pressed }) => [
                  styles.deviceRow,
                  active && styles.deviceRowActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelectDevice(d)}
              >
                <View style={styles.deviceText}>
                  <Text style={styles.deviceName}>{d.name}</Text>
                  <Text style={styles.deviceAddress}>{d.address}</Text>
                </View>
                {active && <Text style={styles.deviceCheck}>✓</Text>}
              </Pressable>
            );
          })}

          <View style={styles.btnRow}>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnSecondary,
                pressed && styles.pressed,
              ]}
              onPress={onListDevices}
              disabled={busy !== null}
            >
              {busy === "list" ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.btnSecondaryText}>
                  {devices ? "Refresh devices" : "Show paired devices"}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                (!saved || busy !== null) && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
              onPress={onTestPrint}
              disabled={!saved || busy !== null}
            >
              {busy === "test" ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.btnPrimaryText}>Test print</Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.s5,
    gap: space.s2,
    ...shadow.card,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hint: { fontSize: 13, color: colors.textMuted },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    marginTop: space.s2,
  },

  segmentRow: { flexDirection: "row", gap: space.s2 },
  segment: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.s3,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  segmentActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  segmentText: { fontSize: 14, fontWeight: "600", color: colors.text },
  segmentTextActive: { color: colors.primaryDark },

  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.s3,
    paddingHorizontal: space.s3,
    gap: space.s3,
  },
  deviceRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  deviceText: { flex: 1 },
  deviceName: { fontSize: 15, fontWeight: "600", color: colors.text },
  deviceAddress: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  deviceCheck: { fontSize: 16, fontWeight: "700", color: colors.primaryDark },

  btnRow: { flexDirection: "row", gap: space.s3, marginTop: space.s2 },
  btn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: space.s3,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.textInverse, fontWeight: "700", fontSize: 14 },
  btnSecondary: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  btnSecondaryText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  btnDisabled: { backgroundColor: colors.borderStrong },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
