/**
 * /subscribe — the paywall.
 *
 * Sits OUTSIDE the `(app)` group on purpose. Everything in that group requires
 * a usable profile, and a locked-out owner has none by definition: `expired`
 * is precisely the state where `AuthContext` stops handing one out. Putting
 * this route inside would make the one screen that can fix the lockout
 * unreachable while locked out.
 */
import { SubscribeScreen } from "@/features/billing/SubscribeScreen";

export default SubscribeScreen;
