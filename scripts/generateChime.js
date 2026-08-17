#!/usr/bin/env node
/**
 * Generate the kitchen's new-order chime: `assets/sounds/new-order.wav`.
 *
 * The asset is generated rather than downloaded so it can be tuned in a diff —
 * a checked-in binary from an unknown source is something nobody can adjust or
 * audit later. Re-run after changing NOTES; the output is deterministic.
 *
 *   node scripts/generateChime.js
 *
 * ## Why it sounds the way it does
 *
 * A kitchen is loud, reverberant and full of low-frequency noise (extractor
 * fans, burners). So:
 *
 * - **Three ascending notes**, not one. A single beep is indistinguishable
 *   from the twenty other beeps in a commercial kitchen; a rising three-note
 *   figure is a melody, and the ear picks a melody out of broadband noise far
 *   better than it picks out a tone.
 * - **Notes in the 1-2kHz range.** That's where speech intelligibility lives
 *   and where extractor-fan noise has already rolled off. Lower notes would be
 *   masked; much higher ones are directional and get lost off-axis.
 * - **Each note is a fundamental plus a half-amplitude octave**, with a fast
 *   attack and exponential decay. That is roughly how a struck bell behaves,
 *   and it reads as a purposeful chime rather than an electronic error tone.
 * - **Short (~1s).** It repeats while the ticket is unacknowledged, so any
 *   individual play has to be over quickly enough not to grate.
 */
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 22050; // Plenty for a ~2kHz chime; keeps the file small.
const CHANNELS = 1;
const BITS = 16;

/** Ascending major triad-ish figure: C6, E6, G6. */
const NOTES = [
  { freq: 1046.5, start: 0.0, dur: 0.45 },
  { freq: 1318.5, start: 0.16, dur: 0.45 },
  { freq: 1568.0, start: 0.32, dur: 0.62 },
];

const TOTAL = 1.0; // seconds
/** Headroom so the summed notes never clip into a rasp. */
const PEAK = 0.62;

/**
 * One struck-bell voice: fundamental + octave partial under a fast-attack,
 * exponential-decay envelope.
 */
function voice(t, freq) {
  const attack = 0.006;
  const env = t < attack ? t / attack : Math.exp(-(t - attack) * 5.2);
  const fundamental = Math.sin(2 * Math.PI * freq * t);
  const octave = 0.5 * Math.sin(2 * Math.PI * freq * 2 * t);
  return env * (fundamental + octave);
}

const frames = Math.round(SAMPLE_RATE * TOTAL);
const samples = new Float64Array(frames);

for (const note of NOTES) {
  const from = Math.round(note.start * SAMPLE_RATE);
  const len = Math.round(note.dur * SAMPLE_RATE);
  for (let i = 0; i < len && from + i < frames; i++) {
    samples[from + i] += voice(i / SAMPLE_RATE, note.freq);
  }
}

// Normalise to PEAK, then fade the last 25ms so the buffer ends at zero — an
// abrupt cut is an audible click on every play.
let max = 0;
for (const s of samples) max = Math.max(max, Math.abs(s));
const gain = max > 0 ? PEAK / max : 0;

const fadeLen = Math.round(0.025 * SAMPLE_RATE);
const pcm = Buffer.alloc(frames * 2);
for (let i = 0; i < frames; i++) {
  const fade = i > frames - fadeLen ? (frames - i) / fadeLen : 1;
  const v = Math.max(-1, Math.min(1, samples[i] * gain * fade));
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}

/** Minimal 44-byte canonical WAV header. */
function wavHeader(dataLength) {
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS) / 8;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataLength, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // PCM chunk size
  h.writeUInt16LE(1, 20); // format = PCM
  h.writeUInt16LE(CHANNELS, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE((CHANNELS * BITS) / 8, 32); // block align
  h.writeUInt16LE(BITS, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataLength, 40);
  return h;
}

const outDir = path.join(__dirname, "..", "assets", "sounds");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "new-order.wav");
fs.writeFileSync(outPath, Buffer.concat([wavHeader(pcm.length), pcm]));

console.log(
  `Wrote ${path.relative(path.join(__dirname, ".."), outPath)} ` +
    `(${(pcm.length / 1024).toFixed(0)} KB, ${TOTAL}s, ${SAMPLE_RATE}Hz mono)`
);
