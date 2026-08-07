/**
 * THE AUTOMATIC BACKEND CHECK — runs inside EVERY EAS build.
 *
 * Wired to `eas-build-post-install` in package.json, which EAS runs on its
 * build machine after installing dependencies and BEFORE the JS bundle is
 * built. By that point the environment variables the app will be compiled with
 * are already resolved — whatever their source (eas.json `env`, the EAS
 * environment named by the profile, or a secret). So this checks what the app
 * will ACTUALLY ship with, not what some config file claims.
 *
 * That is the whole point: nobody has to remember to check anything before a
 * build. A profile pointed at the wrong Firebase project stops here, on the
 * build server, with an explanation — instead of becoming an APK that installs
 * cleanly and then rejects every valid login.
 *
 * Fails ONLY on a real mismatch. An unrecognised profile warns and passes, so
 * adding a build profile can never be blocked by this file.
 */
const { BUILD_TARGETS, checkFirebaseEnv } = require("./buildTargets");

// Set by EAS on the build machine. Absent when run locally (npm test-drives,
// `npm run eas-build-post-install`), where there is nothing to verify.
const profile = process.env.EAS_BUILD_PROFILE;

if (!profile) {
  console.log(
    "[build-target] No EAS_BUILD_PROFILE — not an EAS build, skipping check.",
  );
  process.exit(0);
}

if (!(profile in BUILD_TARGETS)) {
  console.warn(
    `[build-target] WARNING: profile "${profile}" is not listed in ` +
      `scripts/buildTargets.js, so its Firebase backend was NOT verified.\n` +
      `[build-target] Add it there to have this checked automatically.`,
  );
  process.exit(0);
}

const expected = BUILD_TARGETS[profile];
const actual = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;

if (expected === null) {
  console.log(
    `[build-target] Profile "${profile}" is exempt by design ` +
      `(resolved project: ${actual || "none"}).`,
  );
  process.exit(0);
}

const problems = checkFirebaseEnv(process.env, expected);

if (problems.length === 0) {
  console.log(
    `[build-target] OK — profile "${profile}" is building against ` +
      `Firebase project "${expected}".`,
  );
  process.exit(0);
}

console.error(
  `\n[build-target] BUILD STOPPED — wrong Firebase backend.\n\n` +
    `  profile           ${profile}\n` +
    `  expected project  ${expected}\n` +
    `  resolved project  ${actual || "(none)"}\n\n` +
    problems.map((p) => `  - ${p}\n`).join("") +
    `\nThis build would have installed and run normally, then rejected valid\n` +
    `logins because it was talking to a different Firebase project.\n\n` +
    `Fix the EAS environment this profile uses (see eas.json -> ` +
    `build.${profile}.environment):\n` +
    `  eas env:list --environment <env>\n` +
    `  eas env:update --variable-name <NAME> --variable-environment <env> ` +
    `--value <VALUE>\n\n` +
    `If the profile is SUPPOSED to target a different project, update the\n` +
    `table in scripts/buildTargets.js instead.\n`,
);
process.exit(1);
