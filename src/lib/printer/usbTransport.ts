/**
 * USB-C (OTG) transport for the thermal printer.
 *
 * Thin wrapper over the local `modules/usb-printer` Expo module: it turns the
 * native VID/PID pair into the `address` string the rest of the printer code
 * passes around, and turns native failures into cashier-readable errors.
 *
 * The native module is autolinked at prebuild, so it is absent in Expo Go and
 * in any APK built before it landed — every entry point here degrades to
 * "unavailable" rather than throwing on import.
 *
 * Talk to this through `printerService`, not directly.
 */
import { Buffer } from "buffer";
// Local Expo module, deliberately outside src/ — it ships native Android code.
import {
  UsbPrinterNative,
  type UsbPrinterDeviceInfo,
} from "../../../modules/usb-printer";

/**
 * A USB printer's stable identity: vendor + product id, hex, e.g. "04b8:0e15".
 * Android's own `deviceId` is re-assigned on every re-plug, so it can't be the
 * thing we persist — the cashier pairs once and expects it to stick.
 */
export function usbAddress(vendorId: number, productId: number): string {
  const hex = (n: number) => n.toString(16).padStart(4, "0");
  return `${hex(vendorId)}:${hex(productId)}`;
}

function parseUsbAddress(address: string): { vendorId: number; productId: number } {
  const [vid, pid] = address.split(":");
  const vendorId = Number.parseInt(vid ?? "", 16);
  const productId = Number.parseInt(pid ?? "", 16);
  if (Number.isNaN(vendorId) || Number.isNaN(productId)) {
    throw new Error(`Not a USB printer address: "${address}"`);
  }
  return { vendorId, productId };
}

/** Human label for the device list and the "Selected: …" line. */
function displayName(info: UsbPrinterDeviceInfo): string {
  return (
    info.productName ||
    info.manufacturerName ||
    `USB printer ${usbAddress(info.vendorId, info.productId)}`
  );
}

/** True only in a native build, on hardware that supports USB host (OTG). */
export function isUsbPrintingAvailable(): boolean {
  if (!UsbPrinterNative) return false;
  try {
    return UsbPrinterNative.isSupported();
  } catch {
    return false;
  }
}

function requireNative() {
  if (!UsbPrinterNative) {
    throw new Error(
      "USB printing isn't in this build. Install the latest app version."
    );
  }
  return UsbPrinterNative;
}

export interface UsbPrinterListing {
  address: string;
  name: string;
  hasPermission: boolean;
  /** False for vendor-specific clones — printable, just not self-declared. */
  isPrinterClass: boolean;
}

/** Connected USB devices that expose somewhere to send print data. */
export async function listUsbPrinters(): Promise<UsbPrinterListing[]> {
  const devices = await requireNative().listDevices();
  return devices.map((d) => ({
    address: usbAddress(d.vendorId, d.productId),
    name: displayName(d),
    hasPermission: d.hasPermission,
    isPrinterClass: d.isPrinterClass,
  }));
}

/**
 * Android grants USB access per device via a system dialog. Granting survives
 * until the cable is unplugged, so this is a no-op on the common path.
 */
export async function ensureUsbPermission(address: string, name: string): Promise<void> {
  const native = requireNative();
  const { vendorId, productId } = parseUsbAddress(address);
  if (await native.hasPermission(vendorId, productId)) return;
  const granted = await native.requestPermission(vendorId, productId);
  if (!granted) {
    throw new Error(`Permission to use ${name} over USB was denied.`);
  }
}

/** Send raw ESC/POS bytes down the cable. */
export async function printOverUsb(
  address: string,
  name: string,
  bytes: Uint8Array
): Promise<void> {
  await ensureUsbPermission(address, name);
  const { vendorId, productId } = parseUsbAddress(address);
  // base64 because the bridge can't carry raw binary safely.
  await requireNative().write(
    vendorId,
    productId,
    Buffer.from(bytes).toString("base64")
  );
}
