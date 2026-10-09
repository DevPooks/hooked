import { randomUUID } from "node:crypto";

export type Prefix = "app" | "ep" | "evt" | "del" | "att";

export function createId(prefix: Prefix): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
