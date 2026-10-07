/**
 * The owner's phone number — INDIA ONLY, deliberately.
 *
 * There is no country picker and there is not meant to be one. Everything
 * about this product is already India-shaped: prices are in paise and print as
 * ₹ (`src/lib/money.ts`), tax is GST (`src/config/tax.ts`, locale `en-IN`),
 * and the app is sold on one Play listing to Indian restaurants. A country
 * dropdown here would be a question with one right answer, asked of someone
 * who is three fields from finishing a signup — and it would let a typo store
 * a number no one can ring.
 *
 * So the "+91" is FIXED and printed beside the box, and what the owner types
 * is the 10-digit national number. That is also the number they will read out
 * loud if you ask them for it, which is the point.
 *
 * The number is STORED in E.164 (`+919876543210`), never as the ten digits
 * alone. `+91` in the stored value is what stops the field from silently
 * becoming ambiguous the day a second country is worth supporting: an old row
 * says which country it came from, rather than needing that inferred from when
 * it was written.
 */

/** The only country code this app collects. See the note above before adding a second. */
export const PHONE_CC = "+91";

/** Strip everything a person might type around the digits — spaces, dashes,
 *  brackets, a leading "+91" or "0" they added out of habit. */
export function localDigits(raw: string): string {
  let d = raw.replace(/[^0-9]/g, "");
  // "919876543210" / "09876543210" → "9876543210". Only ever trims a prefix
  // that leaves a plausible 10-digit number behind, so a half-typed number is
  // left exactly as typed.
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

/**
 * An Indian MOBILE number: ten digits starting 6–9.
 *
 * Landlines are excluded on purpose. This number exists so a real person can
 * be reached about their restaurant — a call, and in practice WhatsApp (see
 * `src/config/contact.ts`) — and a landline answers neither reliably.
 */
export function isValidPhone(local: string): boolean {
  return /^[6-9][0-9]{9}$/.test(local);
}

/** Ten digits → the stored form, `+919876543210`. */
export function toE164(local: string): string {
  return `${PHONE_CC}${local}`;
}

/** Stored form → the ten digits, for putting back in the input. Tolerates a
 *  value already stored as bare digits. */
export function fromE164(stored: string): string {
  return localDigits(stored);
}

/** "9876543210" → "98765 43210" — how the number is grouped in India. Display
 *  only; never store this. */
export function formatPhone(local: string): string {
  const d = localDigits(local);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}
