// Node stand-in for expo-crypto: same randomUUID/getRandomBytes contracts.
export { randomUUID } from "node:crypto";
import { randomBytes } from "node:crypto";

export function getRandomBytes(byteCount: number): Uint8Array {
  return new Uint8Array(randomBytes(byteCount));
}
