/**
 * Bluetooth thermal-printer service (Android, Bluetooth Classic / SPP).
 *
 * The native module only exists in an EAS/dev-client build — Expo Go has no
 * Bluetooth. Everything here therefore loads `react-native-bluetooth-classic`
 * LAZILY and only after confirming `NativeModules.RNBluetoothClassic` exists
 * (the library wires itself to that native module at import time, so a bare
 * import inside Expo Go could throw). When unavailable, callers get
 * `isPrintingAvailable() === false` and a friendly error — never a crash.
 *
 * Device choice + paper width persist in AsyncStorage (per device, like the
 * other local settings) so the cashier pairs once and just prints.
 */
import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Buffer } from "buffer";
import type BluetoothModule from "react-native-bluetooth-classic/lib/BluetoothModule";
import type { PaperWidth } from "./escpos";

const DEVICE_KEY = "sada.printer.device"; // JSON {address, name}
const PAPER_KEY = "sada.printer.paperWidth"; // "58" | "80"

const CONNECT_TIMEOUT_MS = 12000;

export interface PrinterDevice {
  address: string;
  name: string;
}

/** Shown when printing is attempted inside Expo Go. */
export const PRINTING_UNAVAILABLE_MESSAGE =
  "Printing requires the installed app.";

/** True only in a native build that compiled the Bluetooth module in. */
export function isPrintingAvailable(): boolean {
  return (
    Platform.OS === "android" && NativeModules.RNBluetoothClassic != null
  );
}

let cachedModule: BluetoothModule | null = null;

function getModule(): BluetoothModule {
  if (!isPrintingAvailable()) {
    throw new Error(PRINTING_UNAVAILABLE_MESSAGE);
  }
  if (!cachedModule) {
    // Lazy so Expo Go never evaluates the library's native wiring.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedModule = require("react-native-bluetooth-classic")
      .default as BluetoothModule;
  }
  return cachedModule;
}

/**
 * Runtime permissions before touching the adapter.
 * Android 12+ (API 31): BLUETOOTH_CONNECT + BLUETOOTH_SCAN.
 * Android ≤ 11: legacy ACCESS_FINE_LOCATION gates Bluetooth listing.
 */
export async function ensureBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const api = Number(Platform.Version);
  if (api >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    ]);
    const denied = Object.values(result).some(
      (r) => r !== PermissionsAndroid.RESULTS.GRANTED
    );
    if (denied) {
      throw new Error(
        "Bluetooth permission was denied. Allow Nearby devices in Settings."
      );
    }
  } else {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error(
        "Location permission was denied — Android needs it to list Bluetooth devices."
      );
    }
  }
}

/** Paired (bonded) classic devices — the printer must be paired in Android
 *  Bluetooth settings first; we deliberately don't run discovery. */
export async function listPairedDevices(): Promise<PrinterDevice[]> {
  await ensureBluetoothPermissions();
  const mod = getModule();
  const enabled = await mod.isBluetoothEnabled();
  if (!enabled) {
    throw new Error("Bluetooth is off. Turn it on and try again.");
  }
  const devices = await mod.getBondedDevices();
  return devices.map((d) => ({ address: d.address, name: d.name }));
}

// ── persisted selection ─────────────────────────────────────────────────────

export async function getSavedPrinter(): Promise<PrinterDevice | null> {
  const raw = await AsyncStorage.getItem(DEVICE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PrinterDevice;
  } catch {
    return null;
  }
}

export async function savePrinter(device: PrinterDevice): Promise<void> {
  await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(device));
}

export async function getPaperWidth(): Promise<PaperWidth> {
  const raw = await AsyncStorage.getItem(PAPER_KEY);
  return raw === "80" ? 80 : 58;
}

export async function setPaperWidth(width: PaperWidth): Promise<void> {
  await AsyncStorage.setItem(PAPER_KEY, String(width));
}

// ── printing ────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out. Is the printer on?`)),
        CONNECT_TIMEOUT_MS
      )
    ),
  ]);
}

/** Connect (reusing an open socket when possible) and send raw ESC/POS bytes. */
export async function printToDevice(
  device: PrinterDevice,
  bytes: Uint8Array
): Promise<void> {
  await ensureBluetoothPermissions();
  const mod = getModule();

  const enabled = await mod.isBluetoothEnabled();
  if (!enabled) {
    throw new Error("Bluetooth is off. Turn it on and try again.");
  }

  const connected = await mod.isDeviceConnected(device.address).catch(() => false);
  if (!connected) {
    try {
      await withTimeout(
        mod.connectToDevice(device.address),
        `Connecting to ${device.name}`
      );
    } catch (e) {
      throw new Error(
        `Couldn't connect to ${device.name}. Make sure the printer is on and in range.` +
          (e instanceof Error && e.message ? ` (${e.message})` : "")
      );
    }
  }

  const ok = await withTimeout(
    mod.writeToDevice(device.address, Buffer.from(bytes)),
    "Printing"
  );
  if (!ok) throw new Error(`Sending data to ${device.name} failed.`);
}

/** Print to the SAVED printer; throws a friendly error when none is set. */
export async function printToSavedPrinter(bytes: Uint8Array): Promise<PrinterDevice> {
  const device = await getSavedPrinter();
  if (!device) {
    throw new Error(
      "No printer selected. Open Account > Printer Settings and pick your printer."
    );
  }
  await printToDevice(device, bytes);
  return device;
}

/** Best-effort socket close (e.g. when switching printers). */
export async function disconnectPrinter(device: PrinterDevice): Promise<void> {
  try {
    await getModule().disconnectFromDevice(device.address);
  } catch {
    // Already disconnected / unavailable — nothing to clean up.
  }
}
