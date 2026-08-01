/**
 * Staff management writes (cashier/admin only — enforced server-side by
 * Firestore rules, which also block cashiers from touching admin/cashier
 * profiles or promoting anyone out of waiter/kitchen).
 */
import { deleteDoc, updateDoc } from "firebase/firestore";
import { paths } from "@/lib/firestore/paths";

/** Accept a pending (or previously denied) signup and switch it on. */
export function approveStaff(uid: string): Promise<void> {
  return updateDoc(paths.user(uid), { status: "approved", active: true });
}

/** Reject a signup. The profile stays as a record; the login stays locked out. */
export function denyStaff(uid: string): Promise<void> {
  return updateDoc(paths.user(uid), { status: "denied", active: false });
}

/** Day-off / suspension switch. Their device reacts instantly. */
export function setStaffActive(uid: string, active: boolean): Promise<void> {
  return updateDoc(paths.user(uid), { active });
}

/**
 * Permanently revoke: deletes the profile doc, which locks the login out of
 * every read and write forever. (The bare Firebase Auth login can only be
 * purged from the Firebase console — clients can't delete other users' auth
 * accounts — but without a profile it can access nothing.)
 */
export function removeStaff(uid: string): Promise<void> {
  return deleteDoc(paths.user(uid));
}
