/**
 * Local Expo module: thermal printing over a USB-C (OTG) cable on Android.
 *
 * Autolinked from `modules/` at prebuild, so it exists ONLY in a native build —
 * `UsbPrinterNative` is null in Expo Go and in any APK built before this module
 * landed. Callers must null-check it; `src/lib/printer/usbTransport.ts` is the
 * one place that does.
 */
// From `expo`, not `expo-modules-core` — only `expo` is a declared dependency.
import { requireOptionalNativeModule } from "expo";

/** One connected USB device that can accept print data. */
export interface UsbPrinterDeviceInfo {
  vendorId: number;
  productId: number;
  /** Re-assigned on every re-plug — never persist it. */
  deviceId: number;
  productName: string | null;
  manufacturerName: string | null;
  /** Only readable once permission is granted; null before that. */
  serialNumber: string | null;
  /** Declares USB class 7. False for the many vendor-specific ESC/POS clones. */
  isPrinterClass: boolean;
  hasPermission: boolean;
}

interface UsbPrinterNativeModule {
  /** False on hardware without USB host (OTG) support. */
  isSupported(): boolean;
  /** Connected devices exposing a bulk-OUT endpoint. */
  listDevices(): Promise<UsbPrinterDeviceInfo[]>;
  hasPermission(vendorId: number, productId: number): Promise<boolean>;
  /** Shows the system dialog; resolves false when the user declines. */
  requestPermission(vendorId: number, productId: number): Promise<boolean>;
  /** Raw ESC/POS bytes, base64-encoded (binary-safe across the bridge). */
  write(vendorId: number, productId: number, base64: string): Promise<void>;
}

export const UsbPrinterNative =
  requireOptionalNativeModule<UsbPrinterNativeModule>("SmartServeUsbPrinter");
