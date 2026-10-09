import { createHmac, timingSafeEqual } from "node:crypto";

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function verifySignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const expected = signPayload(secret, timestamp, rawBody);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
