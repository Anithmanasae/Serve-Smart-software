/**
 * One-off maintenance script: shrink the menu item photos already uploaded to
 * Firebase Storage.
 *
 * New uploads are compressed on-device by MenuItemForm (max 800px long edge,
 * JPEG 70%), but photos uploaded before that change are still full-size. This
 * script applies the same rules to the existing ones:
 *
 *   1. reads every restaurants/{RESTAURANT_ID}/menuItems doc with an imageUrl
 *   2. downloads the Storage object behind that URL
 *   3. resizes to fit 800x800 (never upscales) and re-encodes as JPEG q70
 *   4. overwrites the object in place and writes the refreshed download URL
 *      back onto the item doc
 *
 * Items whose image is already within limits, or where compression wouldn't
 * actually save space, are left untouched.
 *
 * Requires scripts/serviceAccount.json (same key as npm run seed).
 *
 * Usage:
 *   node scripts/compressMenuImages.js --dry-run   # report only, change nothing
 *   node scripts/compressMenuImages.js             # compress for real
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");
const sharp = require("sharp");

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccount.json");
const RESTAURANT_ID = process.env.EXPO_PUBLIC_RESTAURANT_ID || "sada-main";
const DRY_RUN = process.argv.includes("--dry-run");

/** Keep in sync with MAX_IMAGE_DIM / compress in MenuItemForm.tsx. */
const MAX_DIM = 800;
const JPEG_QUALITY = 70;

/**
 * Pull the bucket name and object path out of a Firebase download URL:
 * https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path%2Fencoded>?...
 * Returns null for anything that isn't a Firebase Storage URL.
 */
function parseStorageUrl(url) {
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/.exec(
    url
  );
  if (!m) return null;
  return { bucket: m[1], objectPath: decodeURIComponent(m[2]) };
}

function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

async function processItem(db, doc) {
  const item = doc.data();
  const parsed = parseStorageUrl(item.imageUrl);
  if (!parsed) {
    console.log(`- ${doc.id}: imageUrl is not a Firebase Storage URL, skipping`);
    return { saved: 0 };
  }

  const file = admin.storage().bucket(parsed.bucket).file(parsed.objectPath);

  let original;
  try {
    [original] = await file.download();
  } catch (err) {
    console.log(`- ${doc.id}: download failed (${err.message}), skipping`);
    return { saved: 0 };
  }

  const meta = await sharp(original).metadata();
  // .rotate() with no args bakes the EXIF orientation into the pixels so the
  // resized copy doesn't come out sideways.
  const compressed = await sharp(original)
    .rotate()
    .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const alreadySmall =
    (meta.width || 0) <= MAX_DIM &&
    (meta.height || 0) <= MAX_DIM &&
    compressed.length >= original.length * 0.9;
  if (alreadySmall || compressed.length >= original.length) {
    console.log(
      `= ${doc.id}: already small (${kb(original.length)}, ${meta.width}x${meta.height}), skipping`
    );
    return { saved: 0 };
  }

  console.log(
    `${DRY_RUN ? "~" : "+"} ${doc.id}: ${kb(original.length)} (${meta.width}x${meta.height}) -> ${kb(compressed.length)}${DRY_RUN ? " [dry-run, not written]" : ""}`
  );
  if (DRY_RUN) return { saved: original.length - compressed.length };

  // Overwrite in place with a fresh download token, then point the item doc
  // at the new tokenized URL (the old token dies with the old metadata).
  const token = crypto.randomUUID();
  await file.save(compressed, {
    contentType: "image/jpeg",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url =
    `https://firebasestorage.googleapis.com/v0/b/${parsed.bucket}/o/` +
    `${encodeURIComponent(parsed.objectPath)}?alt=media&token=${token}`;
  await doc.ref.update({ imageUrl: url });

  return { saved: original.length - compressed.length };
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      `\nMissing ${SERVICE_ACCOUNT_PATH}\n` +
        "Download it from Firebase console > Project settings > Service accounts > " +
        "Generate new private key, and save it at scripts/serviceAccount.json.\n"
    );
    process.exit(1);
  }

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });

  const db = admin.firestore();
  console.log(
    `Compressing menu images for project "${serviceAccount.project_id}", ` +
      `tenant "${RESTAURANT_ID}"${DRY_RUN ? " (dry run)" : ""}...\n`
  );

  const snap = await db
    .collection(`restaurants/${RESTAURANT_ID}/menuItems`)
    .get();
  const withImages = snap.docs.filter((d) => d.data().imageUrl);
  console.log(
    `${snap.size} menu items, ${withImages.length} with an uploaded image.\n`
  );

  let totalSaved = 0;
  for (const doc of withImages) {
    const { saved } = await processItem(db, doc);
    totalSaved += saved;
  }

  console.log(
    `\n=== Done. Total ${DRY_RUN ? "estimated " : ""}savings: ${kb(totalSaved)} ===`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\nCompression failed:", err);
  process.exit(1);
});
