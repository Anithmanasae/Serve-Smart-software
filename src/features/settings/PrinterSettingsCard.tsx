/**
 * Account tab card: thermal printer setup.
 *
 * Connection (Bluetooth or USB-C), paper width (58/80mm), the device picker,
 * and a test print. All printer work goes through `printerService`, which
 * no-ops gracefully in Expo Go (`isPrintingAvailable()` false → an explainer
 * instead of a crash).
 *
 * One printer is saved at a time, transport included. The connection toggle
 * only picks which list you're browsing — it doesn't change what prints until
 * you tap a device.
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
import { feel } from "@/lib/feedback";
import { colors, radius, shadow, space } from "@/theme/theme";
import { encodeTestTicket, type PaperWidth } from "@/lib/printer/escpos";
import {
  availableTransports,
  disconnectPrinter,
  getPaperWidth,
  getSavedPrinter,
  isPrintingAvailable,
  listPrinters,
  preparePrinter,
  printToDevice,
  savePrinter,
  setPaperWidth,
  transportLabel,
  type PrinterDevice,
  type PrinterTransport,
} from "@/lib/printer/printerService";

const PAPER_WIDTHS: PaperWidth[] = [58, 80];

/** What to do before the device list can show anything, per transport. */
const SETUP_HINT: Record<PrinterTransport, string> = {
  bluetooth:
    "Pair the printer in Android Bluetooth settings, then pick it here.",
  usb: "Connect the printer with a USB-C (OTG) cable, then pick it here. Android asks for permission the first time.",
};

const EMPTY_HINT: Record<PrinterTransport, string> = {
  bluetooth: "No paired devices found.",
  usb: "No USB printer found. Check the cable and that the printer is on.",
};

export function PrinterSettingsCard() {
  const available = isPrintingAvailable();
  const transports = availableTransports();

  const [transport, setTransport] = useState<PrinterTransport>(
    transports[0] ?? "bluetooth"
  );
  const [paper, setPaper] = useState<PaperWidth>(58);
  const [saved, setSaved] = useState<PrinterDevice | null>(null);
  const [devices, setDevices] = useState<PrinterDevice[] | null>(null);
  const [busy, setBusy] = useState<null | "list" | "select" | "test">(null);

  // Hydrate persisted choices once. The saved printer also decides which
  // connection tab opens, so returning here shows the setup you already have.
  useEffect(() => {
    getPaperWidth().then(setPaper).catch(() => {});
    getSavedPrinter()
      .then((device) => {
        if (!device) return;
        setSaved(device);
        if (transports.includes(device.transport)) setTransport(device.transport);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPickPaper(width: PaperWidth) {
    if (width !== paper) feel.select();
    setPaper(width);
    setPaperWidth(width).catch((e) =>
      console.warn("[printer] failed to persist paper width:", e)
    );
  }

  function onPickTransport(next: PrinterTransport) {
    if (next === transport) return;
    feel.select();
    setTransport(next);
    setDevices(null); // The list belongs to the transport it came from.
  }

  async function onListDevices() {
    setBusy("list");
    try {
      setDevices(await listPrinters(transport));
      feel.success(); // a scan that found nothing still completed
    } catch (e) {
      feel.error();
      Alert.alert(
        "Couldn't list printers",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(null);
    }
  }

  async function onSelectDevice(device: PrinterDevice) {
    setBusy("select");
    try {
      // Switching printers: drop the old connection so the new one starts clean.
      if (saved && !isSameDevice(saved, device)) {
        await disconnectPrinter(saved);
      }
      // USB permission is a system dialog — better here than mid-service.
      await preparePrinter(device);
      await savePrinter(device);
      // Pairing is the one setup step people repeat until it works, usually
      // while looking at the printer rather than the tablet.
      feel.success();
      setSaved(device);
    } catch (e) {
      feel.error();
      Alert.alert(
        "Couldn't select that printer",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(null);
    }
  }

  async function onTestPrint() {
    if (!saved) {
      feel.error();
      Alert.alert("No printer selected", "Pick a printer first.");
      return;
    }
    setBusy("test");
    try {
      await printToDevice(saved, encodeTestTicket(paper).bytes);
      feel.success();
      Alert.alert("Test sent", `Check ${saved.name} for the test slip.`);
    } catch (e) {
      feel.error();
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
          Printing requires the installed app. Bluetooth and USB aren't
          available in Expo Go — build and install the APK to set up the
          printer.
        </Text>
      ) : (
        <>
          {/* Connection — only worth showing when there's a choice. */}
          {transports.length > 1 && (
            <>
              <Text style={styles.label}>Connection</Text>
              <View style={styles.segmentRow}>
                {transports.map((t) => {
                  const active = transport === t;
                  return (
                    <Pressable
                      key={t}
                      style={({ pressed }) => [
                        styles.segment,
                        active && styles.segmentActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => onPickTransport(t)}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          active && styles.segmentTextActive,
                        ]}
                      >
                        {transportLabel(t)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

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

          {/* Selected printer + the list for the active connection */}
          <Text style={styles.label}>Printer</Text>
          <Text style={styles.hint}>
            {saved
              ? `Selected: ${saved.name} (${transportLabel(saved.transport)})`
              : SETUP_HINT[transport]}
          </Text>

          {devices !== null && devices.length === 0 && (
            <Text style={styles.hint}>{EMPTY_HINT[transport]}</Text>
          )}
          {devices?.map((d) => {
            const active = saved != null && isSameDevice(saved, d);
            return (
              <Pressable
                key={`${d.transport}:${d.address}`}
                style={({ pressed }) => [
                  styles.deviceRow,
                  active && styles.deviceRowActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelectDevice(d)}
                onPressIn={feel.tap}
                disabled={busy !== null}
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
              onPressIn={feel.tap}
              disabled={busy !== null}
            >
              {busy === "list" || busy === "select" ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.btnSecondaryText}>
                  {devices ? "Refresh devices" : "Show devices"}
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
              onPressIn={feel.tap}
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

/** Address alone isn't unique across transports — compare both. */
function isSameDevice(a: PrinterDevice, b: PrinterDevice): boolean {
  return a.transport === b.transport && a.address === b.address;
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
