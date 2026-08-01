// Metro config with the fixes Firebase JS SDK v11 needs under Expo:
//  - allow .cjs modules
//  - disable package "exports" resolution (Firebase ships an entry Metro
//    otherwise mis-resolves, causing "Component auth has not been registered")
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("cjs");
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
