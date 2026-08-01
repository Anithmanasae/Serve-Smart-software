// Metro config. Firebase JS SDK v12 resolves correctly under Metro's default
// package "exports" support (@firebase/auth declares a react-native condition
// pointing at its RN build), so the v11-era workaround that disabled exports
// resolution is gone. `.cjs` stays on sourceExts — some transitive deps still
// ship CommonJS-only entry points.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("cjs");

module.exports = config;
