/**
 * Who a locked-out trial should get in touch with — you.
 *
 * Set at BUILD time (Expo only exposes EXPO_PUBLIC_* to the bundle), so
 * changing the number means a new build. That's deliberate: it is your sales
 * contact, not a per-restaurant setting, and it must be readable by a device
 * whose Firestore access has just been switched off.
 *
 *   EXPO_PUBLIC_CONTACT_PHONE   full international number, digits only,
 *                               country code included, no "+" or spaces
 *                               (e.g. 919876543210)
 *   EXPO_PUBLIC_CONTACT_NAME    what to call you on the button
 *
 * With no number configured the expiry screen simply omits the button rather
 * than opening a broken link.
 */
import { Linking } from "react-native";

/** Digits only — wa.me rejects "+", spaces and dashes. */
export const CONTACT_PHONE = (process.env.EXPO_PUBLIC_CONTACT_PHONE ?? "").replace(
  /[^0-9]/g,
  "",
);

export const CONTACT_NAME = process.env.EXPO_PUBLIC_CONTACT_NAME ?? "us";

export const hasContact = CONTACT_PHONE.length > 0;

/**
 * Open WhatsApp with a pre-filled message. Native scheme first (opens the app
 * directly), then the wa.me web link, which also works if WhatsApp isn't
 * installed. Same fallback chain as the bill-sharing flow in BillDetail.
 *
 * Returns false if neither could be opened, so the caller can say so.
 */
export async function openContactChat(message: string): Promise<boolean> {
  if (!hasContact) return false;
  const text = encodeURIComponent(message);
  try {
    await Linking.openURL(`whatsapp://send?phone=${CONTACT_PHONE}&text=${text}`);
    return true;
  } catch {
    try {
      await Linking.openURL(`https://wa.me/${CONTACT_PHONE}?text=${text}`);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * The message a locked-out owner sends. It carries exactly what
 * scripts/activateTenant.js needs to find them — the signup email — so
 * activation is a copy-paste rather than a conversation.
 */
export function activationRequestMessage(opts: {
  restaurantName: string | null;
  email: string | null;
}): string {
  const restaurant = opts.restaurantName ?? "my restaurant";
  const email = opts.email ?? "(my signup email)";
  return (
    `Hi! My Smart Serve trial for "${restaurant}" has ended and I'd like to ` +
    `continue.\n\nMy signup email: ${email}`
  );
}
