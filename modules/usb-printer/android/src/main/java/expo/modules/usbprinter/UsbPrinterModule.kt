package expo.modules.usbprinter

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Thermal printing over a USB-C (OTG) cable, using the Android USB Host API.
 *
 * Deliberately dumb: it enumerates devices, gets permission for one, and pushes
 * raw bytes at its bulk-OUT endpoint. ESC/POS encoding stays in JS
 * (`src/lib/printer/escpos.ts`) so both transports print byte-identical
 * receipts and the encoder remains testable without hardware.
 *
 * Devices are addressed by vendorId + productId rather than the USB deviceId,
 * because deviceId is reassigned on every re-plug while VID/PID survive
 * unplugging and reboots — a cashier picks the printer once.
 */
private const val ACTION_USB_PERMISSION = "com.sada.pos.USB_PRINTER_PERMISSION"

/** Per-chunk bulk transfer timeout. Thermal printers ack quickly or not at all. */
private const val WRITE_TIMEOUT_MS = 8000

/**
 * Cheap printer firmware chokes on large bulk writes, so feed it in chunks.
 * 4 KB is a safe multiple of every common max packet size (64/512).
 */
private const val CHUNK_BYTES = 4096

internal class UsbPrinterException(message: String) : CodedException(message)

class UsbPrinterModule : Module() {
  /** Receiver for an in-flight permission dialog; cleared as soon as it fires. */
  private var permissionReceiver: BroadcastReceiver? = null

  private val context: Context
    get() = appContext.reactContext
      ?: throw UsbPrinterException("The app context is unavailable.")

  private val usbManager: UsbManager
    get() = context.getSystemService(Context.USB_SERVICE) as? UsbManager
      ?: throw UsbPrinterException("This device has no USB host support.")

  override fun definition() = ModuleDefinition {
    Name("SmartServeUsbPrinter")

    /** False on phones without OTG — the UI hides the USB option entirely. */
    Function("isSupported") {
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_USB_HOST)
    }

    AsyncFunction("listDevices") {
      usbManager.deviceList.values
        .filter { findBulkOut(it) != null }
        .map { describe(it) }
    }

    AsyncFunction("hasPermission") { vendorId: Int, productId: Int ->
      val device = findDevice(vendorId, productId)
      device != null && usbManager.hasPermission(device)
    }

    AsyncFunction("requestPermission") { vendorId: Int, productId: Int, promise: Promise ->
      val device = findDevice(vendorId, productId)
        ?: throw notFound(vendorId, productId)
      if (usbManager.hasPermission(device)) {
        promise.resolve(true)
      } else {
        requestPermission(device, promise)
      }
    }

    AsyncFunction("write") { vendorId: Int, productId: Int, base64: String ->
      write(vendorId, productId, base64)
    }

    OnDestroy {
      unregisterPermissionReceiver()
    }
  }

  // ── device lookup ─────────────────────────────────────────────────────────

  private fun findDevice(vendorId: Int, productId: Int): UsbDevice? =
    usbManager.deviceList.values.firstOrNull {
      it.vendorId == vendorId && it.productId == productId
    }

  /** VID/PID goes to the log; the cashier gets the actionable half. */
  private fun notFound(vendorId: Int, productId: Int): UsbPrinterException {
    Log.w("UsbPrinter", "No USB device matching $vendorId:$productId")
    return UsbPrinterException(
      "That printer isn't connected. Check the USB-C cable and that the printer is on."
    )
  }

  private data class BulkOut(val iface: UsbInterface, val endpoint: UsbEndpoint)

  /**
   * The interface + endpoint bytes go out on. A printer-class (7) interface
   * wins outright; otherwise we take the first bulk-OUT we find, because plenty
   * of budget ESC/POS printers declare themselves vendor-specific (0xFF).
   */
  private fun findBulkOut(device: UsbDevice): BulkOut? {
    var fallback: BulkOut? = null
    for (i in 0 until device.interfaceCount) {
      val iface = device.getInterface(i)
      for (e in 0 until iface.endpointCount) {
        val endpoint = iface.getEndpoint(e)
        val isBulkOut = endpoint.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
          endpoint.direction == UsbConstants.USB_DIR_OUT
        if (!isBulkOut) continue
        val candidate = BulkOut(iface, endpoint)
        if (iface.interfaceClass == UsbConstants.USB_CLASS_PRINTER) return candidate
        if (fallback == null) fallback = candidate
      }
    }
    return fallback
  }

  private fun describe(device: UsbDevice): Map<String, Any?> {
    val granted = usbManager.hasPermission(device)
    return mapOf(
      "vendorId" to device.vendorId,
      "productId" to device.productId,
      "deviceId" to device.deviceId,
      "productName" to runCatching { device.productName }.getOrNull(),
      "manufacturerName" to runCatching { device.manufacturerName }.getOrNull(),
      // Reading the serial needs the permission we may not have yet (API 29+
      // throws instead of returning null).
      "serialNumber" to if (granted) runCatching { device.serialNumber }.getOrNull() else null,
      "isPrinterClass" to (0 until device.interfaceCount).any {
        device.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_PRINTER
      },
      "hasPermission" to granted
    )
  }

  // ── permission ────────────────────────────────────────────────────────────

  /**
   * Android grants USB access per device, via a system dialog. The answer comes
   * back as a broadcast, so the promise is resolved from the receiver.
   */
  private fun requestPermission(device: UsbDevice, promise: Promise) {
    // Not `appContext` — that name belongs to the Expo module itself.
    val ctx = context.applicationContext

    // A dialog is already up for a previous call — drop its receiver first so
    // one broadcast can't resolve two promises.
    unregisterPermissionReceiver()

    val receiver = object : BroadcastReceiver() {
      override fun onReceive(received: Context?, intent: Intent?) {
        if (intent?.action != ACTION_USB_PERMISSION) return
        unregisterPermissionReceiver()
        promise.resolve(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false))
      }
    }
    permissionReceiver = receiver

    val filter = IntentFilter(ACTION_USB_PERMISSION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      ctx.registerReceiver(receiver, filter)
    }

    // Explicit package + FLAG_MUTABLE: Android 14 rejects the implicit form,
    // and UsbManager has to be able to write the result into the intent.
    val intent = Intent(ACTION_USB_PERMISSION).setPackage(ctx.packageName)
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_MUTABLE
    } else {
      0
    }
    usbManager.requestPermission(
      device,
      PendingIntent.getBroadcast(ctx, 0, intent, flags)
    )
  }

  private fun unregisterPermissionReceiver() {
    val receiver = permissionReceiver ?: return
    permissionReceiver = null
    runCatching { context.applicationContext.unregisterReceiver(receiver) }
  }

  // ── printing ──────────────────────────────────────────────────────────────

  /**
   * Runs on the module's async queue, never the UI thread — `bulkTransfer`
   * blocks until the printer drains the chunk or the timeout expires.
   */
  private fun write(vendorId: Int, productId: Int, base64: String) {
    val device = findDevice(vendorId, productId) ?: throw notFound(vendorId, productId)
    if (!usbManager.hasPermission(device)) {
      throw UsbPrinterException("USB permission for this printer was denied.")
    }
    val target = findBulkOut(device)
      ?: throw UsbPrinterException("That USB device doesn't accept print data.")

    val connection = usbManager.openDevice(device)
      ?: throw UsbPrinterException("Couldn't open the printer. Unplug the cable and try again.")

    try {
      // force = true steals the interface from any kernel driver holding it.
      if (!connection.claimInterface(target.iface, true)) {
        throw UsbPrinterException("The printer is busy — another app may be using it.")
      }
      try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        var offset = 0
        while (offset < bytes.size) {
          val length = minOf(CHUNK_BYTES, bytes.size - offset)
          val sent = connection.bulkTransfer(
            target.endpoint, bytes, offset, length, WRITE_TIMEOUT_MS
          )
          // 0 would mean no progress, so treat it as failure rather than spin.
          if (sent <= 0) {
            throw UsbPrinterException(
              "Printing stopped after $offset of ${bytes.size} bytes. Is the printer out of paper?"
            )
          }
          offset += sent
        }
      } finally {
        connection.releaseInterface(target.iface)
      }
    } finally {
      connection.close()
    }
  }
}
