/**
 * Thermal-printer service — the only printer API screens should import.
 *
 * Two transports sit behind it, both Android-only and both native-build-only:
 *  - `bluetoothTransport` — Bluetooth Classic / SPP, printer paired in Android
 *    settings.
 *  - `usbTransport` — a USB-C (OTG) cable straight into the printer.
 *
 * Neither exists in Expo Go, so every entry point degrades to
 * `isPrintingAvailable() === false` and a friendly error — never a crash.
 *
 * Device choice (including which transport) and paper width persist in
 * AsyncStorage per device, like the other local settings, so the cashier sets
 * up once and just prints.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PaperWidth } from "./escpos";
import {
  disconnectBluetooth,
  isBluetoothPrintingAvailable,
  listBluetoothPrinters,
  printOverBluetooth,
} from "./bluetoothTransport";
import {
  ensureUsbPermission,
  isUsbPrintingAvailable,
  listUsbPrinters,
  printOverUsb,
} from "./usbTransport";

const DEVICE_KEY = "sada.printer.device"; // JSON PrinterDevice
const PAPER_KEY = "sada.printer.paperWidth"; // "58" | "80"

/** How the bytes reach the printer. */
export type PrinterTransport = "bluetooth" | "usb";

export interface PrinterDevice {
  transport: PrinterTransport;
  /** Bluetooth: MAC address. USB: "vvvv:pppp" (vendor:product, hex). */
  address: string;
  name: string;
}

/** Shown when printing is attempted inside Expo Go. */
export const PRINTING_UNAVAILABLE_MESSAGE =
  "Printing requires the installed app.";

/** Transports this build + this hardware can actually use, in offer order. */
export function availableTransports(): PrinterTransport[] {
  const transports: PrinterTransport[] = [];
  if (isBluetoothPrintingAvailable()) transports.push("bluetooth");
  if (isUsbPrintingAvailable()) transports.push("usb");
  return transports;
}

/** True when at least one transport is usable. */
export function isPrintingAvailable(): boolean {
  return availableTransports().length > 0;
}

/** "Bluetooth" / "USB-C" — for buttons and error copy. */
export function transportLabel(transport: PrinterTransport): string {
  return transport === "usb" ? "USB-C" : "Bluetooth";
}

/** Paired (Bluetooth) or connected (USB) printers for one transport. */
export async function listPrinters(
  transport: PrinterTransport
): Promise<PrinterDevice[]> {
  if (transport === "usb") {
    const devices = await listUsbPrinters();
    return devices.map((d) => ({
      transport: "usb" as const,
      address: d.address,
      name: d.name,
    }));
  }
  const devices = await listBluetoothPrinters();
  return devices.map((d) => ({
    transport: "bluetooth" as const,
    address: d.address,
    name: d.name,
  }));
}

// ── persisted selection ─────────────────────────────────────────────────────

export async function getSavedPrinter(): Promise<PrinterDevice | null> {
  const raw = await AsyncStorage.getItem(DEVICE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PrinterDevice>;
    if (!parsed.address || !parsed.name) return null;
    return {
      // Saved before USB existed → it was a Bluetooth printer.
      transport: parsed.transport === "usb" ? "usb" : "bluetooth",
      address: parsed.address,
      name: parsed.name,
    };
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

/**
 * Ask for whatever the transport needs up front — the USB permission dialog —
 * so the cashier meets it while setting up, not mid-service with a queue
 * waiting. Bluetooth pairs in Android settings, so there is nothing to do.
 */
export async function preparePrinter(device: PrinterDevice): Promise<void> {
  if (device.transport === "usb") {
    await ensureUsbPermission(device.address, device.name);
  }
}

/** Send raw ESC/POS bytes over whichever transport the device uses. */
export async function printToDevice(
  device: PrinterDevice,
  bytes: Uint8Array
): Promise<void> {
  if (device.transport === "usb") {
    await printOverUsb(device.address, device.name, bytes);
    return;
  }
  await printOverBluetooth(device.address, device.name, bytes);
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

/**
 * Best-effort release (e.g. when switching printers). USB claims the interface
 * only for the length of a write, so there is nothing to release there.
 */
export async function disconnectPrinter(device: PrinterDevice): Promise<void> {
  if (device.transport === "bluetooth") {
    await disconnectBluetooth(device.address);
  }
}
