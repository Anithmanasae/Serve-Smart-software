/**
 * Generates the Brew Brothers brand PNGs in `assets/brand/` from the owner's
 * supplied logo (`brew-brothers-source.jpeg`).
 *
 * The source is a screenshot: the round gold-on-black badge sits on a striped
 * wood backdrop with dark bars along the top and bottom edges. Every asset
 * here starts by cutting the badge out of that backdrop, because the wood is
 * not part of the logo and would otherwise appear as a square patch behind the
 * mark on every screen it lands on.
 *
 * Measured off the source: the badge is centred at (367, 388) with a radius of
 * ~366px. The mask is pulled 4px inside that so the wood's fringe — smeared by
 * JPEG compression — is cut away rather than left as a halo.
 *
 * Two crops, because one image cannot serve both sizes:
 *
 *  - `bb-badge.png`  the whole badge, wordmark included. For the login lockup,
 *                    the splash and the launcher icon, where it is 88px+ and
 *                    the baked-in "BREW BROTHERS" is legible.
 *  - `bb-mark.png`   the cup alone, cropped above the wordmark. For the 22px
 *                    app-bar mark, where the baked-in text would be three
 *                    illegible grey smears and the screens supply the name as
 *                    real text beside it.
 *
 * Run:  node scripts/generateBrewBrothersAssets.js
 */
const path = require("path");
const sharp = require("sharp");

const BRAND_DIR = path.join(__dirname, "..", "assets", "brand");
const SRC = path.join(BRAND_DIR, "brew-brothers-source.jpeg");

// The badge within the source, measured by probing outward from the centre
// until the black/gold gives way to wood.
const CX = 367;
const CY = 388;
const R = 362;

// The cup+monogram artwork, above the wordmark — its own smaller disc, not a
// rectangle. A rectangular crop wide enough to clear the cup's handle has
// corners that fall OUTSIDE the badge, which drags the wood back in at exactly
// the size where it is least affordable.
//
// Centred on the cup rather than on the badge, and r=240 so the circle stops
// short of the wordmark below (which starts at y≈578) while still clearing the
// steam above (y≈111) and the handle to the right.
const MARK_CX = 380;
const MARK_CY = 330;
const MARK_R = 240;

// The badge's own black. The splash and the adaptive icon sit on this rather
// than on the app's navy: a black disc floating on navy reads as a sticker
// someone left on the screen, and the gold is what should be doing the work.
const BLACK = "#0b0a08";

/** A circular alpha mask the size of the badge crop. */
function circleMask(size) {
  return Buffer.from(
    `<svg width="${size}" height="${size}">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>` +
      `</svg>`
  );
}

/** A circular cut-out of the source at `size`px, with transparency outside. */
async function disc(cx, cy, r, size) {
  const crop = await sharp(SRC)
    .extract({ left: cx - r, top: cy - r, width: r * 2, height: r * 2 })
    .resize(size, size, { fit: "fill" })
    .toBuffer();

  return sharp(crop)
    .composite([{ input: circleMask(size), blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** The whole badge, wordmark included, cut out of the wood backdrop. */
const badge = (size) => disc(CX, CY, R, size);

async function main() {
  // ── In-app badge (login lockup) ──────────────────────────────────────────
  await sharp(await badge(512)).toFile(path.join(BRAND_DIR, "bb-badge.png"));

  // ── In-app mark (app bars, empty states) ─────────────────────────────────
  await sharp(await disc(MARK_CX, MARK_CY, MARK_R, 256)).toFile(
    path.join(BRAND_DIR, "bb-mark.png")
  );

  // ── Splash logo ──────────────────────────────────────────────────────────
  // Transparent, on the black splash background set in app.json.
  await sharp(await badge(768)).toFile(path.join(BRAND_DIR, "logo.png"));

  // ── Launcher icon ────────────────────────────────────────────────────────
  // Flattened onto black: a launcher icon may not carry alpha on iOS, and a
  // transparent one is rendered against unpredictable wallpaper on Android.
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: BLACK,
    },
  })
    .composite([{ input: await badge(1024) }])
    .png()
    .toFile(path.join(BRAND_DIR, "icon.png"));

  // ── Android adaptive foreground ──────────────────────────────────────────
  // Android crops the outer ~25% of this square to whatever mask the launcher
  // uses, so the badge is inset to 62% and centred: at full bleed a circular
  // launcher would shave the badge's own gold ring off.
  const inset = Math.round(432 * 0.62);
  await sharp({
    create: {
      width: 432,
      height: 432,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await badge(inset),
        left: Math.round((432 - inset) / 2),
        top: Math.round((432 - inset) / 2),
      },
    ])
    .png()
    .toFile(path.join(BRAND_DIR, "adaptive-icon.png"));

  console.log("Brew Brothers brand assets written to assets/brand/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
