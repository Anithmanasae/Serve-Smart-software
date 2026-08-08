/**
 * Bluetooth Classic (SPP) transport for the thermal printer.
 *
 * The native module only exists in an EAS/dev-client build — Expo Go has no
 * Bluetooth. Everything here therefore loads `react-native-bluetooth-classic`
 * LAZILY and only after confirming `NativeModules.RNBluetoothClassic` exists
 * (the library wires itself to that native module at import time, so a bare
 * import inside Expo Go could throw). When unavailable, callers get
 * `isBluetoothPrintingAvailable() === false` and a friendly error — never a
 * crash.
 *
 * Talk to this through `printerService`, not directly.
 */
import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import { Buffer } from "buffer";
import type BluetoothModule from "react-native-bluetooth-classic/lib/BluetoothModule";

const CONNECT_TIMEOUT_MS = 12000;

/** True only in a native build that compiled the Bluetooth module in. */
export function isBluetoothPrintingAvailable(): boolean {
  return Platform.OS === "android" && NativeModules.RNBluetoothClassic != null;
}

let cachedModule: BluetoothModule | null = null;

function getModule(): BluetoothModule {
  if (!isBluetoothPrintingAvailable()) {
    throw new Error("Bluetooth printing isn't available in this build.");
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
export async function listBluetoothPrinters(): Promise<
  { address: string; name: string }[]
> {
  await ensureBluetoothPermissions();
  const mod = getModule();
  const enabled = await mod.isBluetoothEnabled();
  if (!enabled) {
    throw new Error("Bluetooth is off. Turn it on and try again.");
  }
  const devices = await mod.getBondedDevices();
  return devices.map((d) => ({ address: d.address, name: d.name }));
}

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
export async function printOverBluetooth(
  address: string,
  name: string,
  bytes: Uint8Array
): Promise<void> {
  await ensureBluetoothPermissions();
  const mod = getModule();

  const enabled = await mod.isBluetoothEnabled();
  if (!enabled) {
    throw new Error("Bluetooth is off. Turn it on and try again.");
  }

  const connected = await mod.isDeviceConnected(address).catch(() => false);
  if (!connected) {
    try {
      await withTimeout(mod.connectToDevice(address), `Connecting to ${name}`);
    } catch (e) {
      throw new Error(
        `Couldn't connect to ${name}. Make sure the printer is on and in range.` +
          (e instanceof Error && e.message ? ` (${e.message})` : "")
      );
    }
  }

  const ok = await withTimeout(
    mod.writeToDevice(address, Buffer.from(bytes)),
    "Printing"
  );
  if (!ok) throw new Error(`Sending data to ${name} failed.`);
}

/** Best-effort socket close (e.g. when switching printers). */
export async function disconnectBluetooth(address: string): Promise<void> {
  try {
    await getModule().disconnectFromDevice(address);
  } catch {
    // Already disconnected / unavailable — nothing to clean up.
  }
}
