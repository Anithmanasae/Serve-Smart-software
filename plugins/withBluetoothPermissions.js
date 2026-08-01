/**
 * Expo config plugin: Android Bluetooth permissions for the thermal printer.
 *
 * The plain `android.permissions` array can't express attributes, and two of
 * them matter here:
 *  - BLUETOOTH_SCAN needs android:usesPermissionFlags="neverForLocation"
 *    (we never derive location from scans — Play Console requires the flag).
 *  - The legacy BLUETOOTH / BLUETOOTH_ADMIN / ACCESS_FINE_LOCATION set is
 *    only for Android ≤ 11 (maxSdkVersion 30); API 31+ uses CONNECT/SCAN.
 *
 * Runs at prebuild (EAS), so Expo Go is unaffected.
 */
const { withAndroidManifest } = require("expo/config-plugins");

function ensurePermission(androidManifest, name, attrs = {}) {
  const manifest = androidManifest.manifest;
  if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
  const permissions = manifest["uses-permission"];
  let entry = permissions.find((p) => p.$["android:name"] === name);
  if (!entry) {
    entry = { $: { "android:name": name } };
    permissions.push(entry);
  }
  Object.assign(entry.$, attrs);
}

module.exports = function withBluetoothPermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    ensurePermission(manifest, "android.permission.BLUETOOTH_CONNECT");
    ensurePermission(manifest, "android.permission.BLUETOOTH_SCAN", {
      "android:usesPermissionFlags": "neverForLocation",
    });
    ensurePermission(manifest, "android.permission.BLUETOOTH", {
      "android:maxSdkVersion": "30",
    });
    ensurePermission(manifest, "android.permission.BLUETOOTH_ADMIN", {
      "android:maxSdkVersion": "30",
    });
    ensurePermission(manifest, "android.permission.ACCESS_FINE_LOCATION", {
      "android:maxSdkVersion": "30",
    });
    return config;
  });
};
