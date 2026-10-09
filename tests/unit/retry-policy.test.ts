import { describe, expect, it } from "vitest";
import { retryDelay, shouldRetryStatus } from "../../src/services/retry-policy.js";

describe("retry policy", () => {
  it("uses a bounded backoff schedule", () => {
    expect(retryDelay(1)).toBe(30_000);
    expect(retryDelay(4)).toBe(1_800_000);
    expect(retryDelay(99)).toBe(1_800_000);
  });

  it("retries transient statuses but not ordinary client errors", () => {
    expect(shouldRetryStatus(408)).toBe(true);
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
    expect(shouldRetryStatus(400)).toBe(false);
  });
});
