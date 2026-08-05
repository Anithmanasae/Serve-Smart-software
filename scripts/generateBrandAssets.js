/**
 * Generates the Smart Serve brand PNGs in `assets/brand/` from vector sources.
 *
 * The mark is a serving cloche (dome + plate) with a sparkle — "serve" plus the
 * "smart". Navy from the theme (`colors.primary` / `primaryDark`), white mark.
 * The in-app wordmark lives in `src/components/BrandLogo.tsx` (react-native-svg,
 * real Plus Jakarta Sans); this script only produces the raster assets Expo
 * needs at build time: the launcher icon, the Android adaptive foreground, and
 * the splash logo.
 *
 * Run:  npm run brand
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT_DIR = path.join(__dirname, "..", "assets", "brand");
const FONT_FILE = path.join(
  __dirname,
  "..",
  "node_modules",
  "@expo-google-fonts",
  "plus-jakarta-sans",
  "800ExtraBold",
  "PlusJakartaSans_800ExtraBold.ttf"
);

// Theme tokens (kept in sync with src/theme/theme.ts by hand — this script runs
// in plain Node and can't import the TS module).
const NAVY = "#0047A1";
const NAVY_DARK = "#00336F";
const WHITE = "#ffffff";

/**
 * A four-point "sparkle" — concave diamond, the modern shorthand for smart.
 * `s` is the tip radius; control points at 0.24s give the pinched waist.
 */
function sparkle(cx, cy, s) {
  const k = s * 0.24;
  return [
    `M ${cx} ${cy - s}`,
    `C ${cx} ${cy - k} ${cx + k} ${cy} ${cx + s} ${cy}`,
    `C ${cx + k} ${cy} ${cx} ${cy + k} ${cx} ${cy + s}`,
    `C ${cx} ${cy + k} ${cx - k} ${cy} ${cx - s} ${cy}`,
    `C ${cx - k} ${cy} ${cx} ${cy - k} ${cx} ${cy - s}`,
    "Z",
  ].join(" ");
}

/**
 * The cloche mark, drawn in a 120x120 box and optically centred. `fg` paints
 * the dome/plate, `accent` the sparkles (same colour unless you want contrast).
 *
 * The big sparkle replaces the cloche's handle, so "smart" is part of the
 * object rather than floating beside it; the small one just adds rhythm.
 */
function markPaths(fg, accent = fg) {
  return `
    <g transform="translate(0, 6)">
      <!-- dome -->
      <path d="M 30 75 A 30 30 0 0 1 90 75 Z" fill="${fg}"/>
      <!-- plate -->
      <rect x="20" y="79" width="80" height="9" rx="4.5" fill="${fg}"/>
      <!-- sparkle handle -->
      <path d="${sparkle(60, 33, 13)}" fill="${accent}"/>
      <path d="${sparkle(86, 27, 5.5)}" fill="${accent}"/>
    </g>`;
}

/** Full-bleed navy badge + white mark — the iOS/web launcher icon. */
function iconSvg(size) {
  const inset = size * 0.17; // mark ink lands at ~44% of the tile
  const markSize = size - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stop-color="#0b56bd"/>
        <stop offset="1" stop-color="${NAVY_DARK}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#bg)"/>
    <svg x="${inset}" y="${inset}" width="${markSize}" height="${markSize}" viewBox="0 0 120 120">
      ${markPaths(WHITE)}
    </svg>
  </svg>`;
}

/**
 * Android adaptive foreground: transparent, with the mark inside the 66% safe
 * circle so no launcher mask can clip it. `app.json` supplies the navy plate.
 */
function adaptiveSvg(size) {
  // Ink diagonal lands just inside the 66%-diameter safe circle.
  const inset = size * 0.15;
  const markSize = size - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <svg x="${inset}" y="${inset}" width="${markSize}" height="${markSize}" viewBox="0 0 120 120">
      ${markPaths(WHITE)}
    </svg>
  </svg>`;
}

/** Splash logo: the mark alone, transparent — the wordmark is composited on. */
function splashMarkSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">
    ${markPaths(WHITE)}
  </svg>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── Launcher icon + Android adaptive foreground ──────────────────────────
  await sharp(Buffer.from(iconSvg(1024)))
    .png()
    .toFile(path.join(OUT_DIR, "icon.png"));
  console.log("wrote icon.png (1024x1024)");

  await sharp(Buffer.from(adaptiveSvg(1024)))
    .png()
    .toFile(path.join(OUT_DIR, "adaptive-icon.png"));
  console.log("wrote adaptive-icon.png (1024x1024)");

  // ── Splash logo: mark stacked over the wordmark ──────────────────────────
  // Pango renders the wordmark with the real Plus Jakarta Sans file, so the
  // splash matches the typography the app itself loads. Both halves are
  // trimmed to their ink before layout — the SVG viewBox and Pango's line box
  // both carry padding that would otherwise fake the spacing.
  const MARK_H = 300;
  const mark = await sharp(Buffer.from(splashMarkSvg(900)))
    .trim()
    .resize({ height: MARK_H })
    .png()
    .toBuffer();
  const markMeta = await sharp(mark).metadata();

  const wordmarkRaw = await sharp({
    text: {
      text: `<span foreground="${WHITE}" letter_spacing="1200">Smart Serve</span>`,
      font: "Plus Jakarta Sans ExtraBold",
      fontfile: FONT_FILE,
      rgba: true,
      dpi: 400,
    },
  })
    .png()
    .toBuffer();
  // 1.7x the mark's width — the same lockup ratio BrandLogo.tsx renders in-app,
  // so the splash and the login screen read as one brand.
  const wordmark = await sharp(wordmarkRaw)
    .trim()
    .resize({ width: Math.round(markMeta.width * 1.7) })
    .png()
    .toBuffer();
  const wordMeta = await sharp(wordmark).metadata();

  const GAP = Math.round(MARK_H * 0.2);
  const PAD = 48;
  const canvasW = Math.max(markMeta.width, wordMeta.width) + PAD * 2;
  const canvasH = markMeta.height + GAP + wordMeta.height + PAD * 2;

  await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: mark,
        left: Math.round((canvasW - markMeta.width) / 2),
        top: PAD,
      },
      {
        input: wordmark,
        left: Math.round((canvasW - wordMeta.width) / 2),
        top: PAD + markMeta.height + GAP,
      },
    ])
    .png()
    .toFile(path.join(OUT_DIR, "logo.png"));
  console.log(`wrote logo.png (${canvasW}x${canvasH})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
