/**
 * PRE-BUILD CHECK — does EAS actually agree with .env.local about which
 * Firebase project this app talks to?
 *
 * WHY THIS EXISTS
 * `.env.local` is gitignored, so it never reaches an EAS build. A build takes
 * its Firebase config from EAS's own stored environment variables instead. The
 * two can drift apart silently — and when they do, the app compiles fine,
 * installs fine, shows the right branding, and then rejects a perfectly valid
 * login with "invalid email or password", because it is asking a completely
 * different Firebase project.
 *
 * That is exactly what happened once here: the EAS preview AND production
 * environments still pointed at a different project inherited from another app,
 * so the demo APK talked to the wrong backend.
 *
 * Run this BEFORE `eas build` and it fails loudly instead.
 *
 * Usage:
 *   npm run verify:env                 # checks preview + production
 *   npm run verify:env -- preview      # just one environment
 */
const { execSync } = require("child_process");
const { existsSync, readFileSync } = require("fs");
const path = require("path");

const KEYS = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
];

function parseEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

/** `eas env:list --format short` → { NAME: value } */
function easEnv(environment) {
  // Whitelisted so the name can never be smuggled into the shell command.
  if (!/^[a-z]+$/.test(environment)) {
    console.error(`\nInvalid environment name "${environment}".\n`);
    process.exit(1);
  }
  let stdout;
  try {
    // shell:true is required on Windows — Node refuses to exec a .cmd shim
    // (which is how npm installs the eas CLI) without one.
    stdout = execSync(
      `eas env:list --environment ${environment} --format short`,
      {
        encoding: "utf8",
        env: { ...process.env, EAS_NO_VCS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      },
    );
  } catch (e) {
    console.error(`\nCould not read the EAS "${environment}" environment.`);
    console.error(String(e.stderr || e.message).trim());
    console.error("\nIs the eas CLI installed and are you logged in? (eas whoami)\n");
    process.exit(1);
  }
  const out = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function check(environment, local) {
  const remote = easEnv(environment);
  const problems = [];
  for (const key of KEYS) {
    const want = local[key];
    const got = remote[key];
    if (!want) continue; // nothing to compare against
    if (got === undefined) problems.push(`${key}: MISSING on EAS`);
    else if (got !== want) problems.push(`${key}:\n      EAS   ${got}\n      local ${want}`);
  }
  const label = `EAS "${environment}"`;
  if (problems.length === 0) {
    console.log(`  OK   ${label} matches .env.local (${remote.EXPO_PUBLIC_FIREBASE_PROJECT_ID})`);
    return true;
  }
  console.log(`  FAIL ${label} disagrees with .env.local:`);
  for (const p of problems) console.log(`    - ${p}`);
  return false;
}

const local = parseEnvFile(path.join(process.cwd(), ".env.local"));
if (!local.EXPO_PUBLIC_FIREBASE_PROJECT_ID) {
  console.error("\n.env.local has no EXPO_PUBLIC_FIREBASE_PROJECT_ID — nothing to verify against.\n");
  process.exit(1);
}

const environments = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["preview", "production"];

console.log(
  `\nVerifying EAS build config against .env.local ` +
    `(${local.EXPO_PUBLIC_FIREBASE_PROJECT_ID})\n`,
);

let ok = true;
for (const e of environments) ok = check(e, local) && ok;

if (!ok) {
  console.error(
    `\nA build from a mismatched environment will install and run, then reject\n` +
      `valid logins because it is talking to a different Firebase project.\n\n` +
      `Fix with:\n` +
      `  eas env:update --variable-name <NAME> --variable-environment <ENV> --value <VALUE>\n`,
  );
  process.exit(1);
}
console.log(`\nAll checked environments agree. Safe to build.\n`);
