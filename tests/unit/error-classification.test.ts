import { describe, expect, it } from "vitest";
import { classifyNetworkError } from "../../src/services/http-delivery.js";

describe("delivery error classification", () => {
  it.each([
    ["ETIMEDOUT", "timeout"],
    ["ENOTFOUND", "dns"],
    ["ECONNREFUSED", "connection_refused"],
    ["CERT_HAS_EXPIRED", "tls"],
    ["SOMETHING_NEW", "unknown"],
  ])("maps %s to %s", (code, category) => {
    expect(classifyNetworkError(Object.assign(new Error("test"), { code }))).toBe(category);
  });
});
