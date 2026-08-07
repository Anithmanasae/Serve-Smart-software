/**
 * PRE-BUILD CHECK — is each EAS environment pointed at the Firebase project it
 * is supposed to be pointed at?
 *
 * WHY THIS EXISTS
 * `.env.local` is gitignored, so it never reaches an EAS build. A build takes
 * its Firebase config from EAS's own stored environment variables instead. The
 * two can drift apart silently — and when they do, the app compiles fine,
 * installs fine, shows the right branding, and then rejects a perfectly valid
 * login with "invalid email or password", because it is asking a completely
 * different Firebase project.
 *
 * That is exactly what happened once here: the EAS preview environment still
 * pointed at a different project inherited from another app, so the demo APK
 * talked to the wrong backend.
 *
 * The expected project for each environment comes from scripts/buildTargets.js
 * — NOT from .env.local. This repo ships more than one white-labelled product
 * from one EAS project, so "everything must equal my local dev config" is the
 * wrong rule: `preview` legitimately targets a different customer's backend,
 * and blindly "fixing" it would break their builds.
 *
 * THIS IS THE OPTIONAL, MANUAL FORM OF THE CHECK. The same comparison runs
 * automatically inside every EAS build (scripts/assertBuildTarget.js), so a
 * wrong-backend APK cannot be produced even if nobody runs this. Use this when
 * you want to see the state of things BEFORE burning a build.
 *
 * Usage:
 *   npm run verify:env                 # checks preview + production
 *   npm run verify:env -- production   # just one environment
 */
const { execSync } = require("child_process");
const { existsSync, readFileSync } = require("fs");
const path = require("path");
const {
  BUILD_TARGETS,
  REQUIRED_KEYS,
  checkFirebaseEnv,
} = require("./buildTargets");

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
  const label = `EAS "${environment}"`;

  if (!(environment in BUILD_TARGETS)) {
    console.log(
      `  SKIP ${label} — no expected project in scripts/buildTargets.js`,
    );
    return true;
  }
  const expected = BUILD_TARGETS[environment];
  const remote = easEnv(environment);
  const problems = checkFirebaseEnv(remote, expected);

  // Only when an environment targets the SAME project as this machine's
  // .env.local can we compare key by key — that catches a stale API key or app
  // id within an otherwise correct project. For another product's backend we
  // have no local copy to compare against, and must not invent one.
  if (expected && expected === local.EXPO_PUBLIC_FIREBASE_PROJECT_ID) {
    for (const key of REQUIRED_KEYS) {
      const want = local[key];
      const got = remote[key];
      if (!want || got === undefined || got === want) continue;
      problems.push(`${key}:\n      EAS   ${got}\n      local ${want}`);
    }
  }

  if (problems.length === 0) {
    const target = expected ?? remote.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
    console.log(`  OK   ${label} -> ${target}`);
    return true;
  }
  console.log(`  FAIL ${label} (expected ${expected}):`);
  for (const p of problems) console.log(`    - ${p}`);
  return false;
}

const local = parseEnvFile(path.join(process.cwd(), ".env.local"));

const environments = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["preview", "production"];

console.log(
  `\nVerifying EAS environments against scripts/buildTargets.js` +
    (local.EXPO_PUBLIC_FIREBASE_PROJECT_ID
      ? ` (local .env.local: ${local.EXPO_PUBLIC_FIREBASE_PROJECT_ID})`
      : ""),
  "\n",
);

let ok = true;
for (const e of environments) ok = check(e, local) && ok;

if (!ok) {
  console.error(
    `\nA build from a mismatched environment will install and run, then reject\n` +
      `valid logins because it is talking to a different Firebase project.\n\n` +
      `Fix the environment:\n` +
      `  eas env:update --variable-name <NAME> --variable-environment <ENV> --value <VALUE>\n\n` +
      `...or, if the environment is SUPPOSED to target that project, update the\n` +
      `table in scripts/buildTargets.js.\n`,
  );
  process.exit(1);
}
console.log(`\nAll checked environments match their expected backend.\n`);
