import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

describe("configuration", () => {
  it("parses explicit booleans and retry delays", () => {
    const config = loadConfig({ ALLOW_PRIVATE_ENDPOINTS: "true", WEBHOOK_RETRY_DELAYS_MS: "0,5,10" });
    expect(config.allowPrivateEndpoints).toBe(true);
    expect(config.webhookRetryDelaysMs).toEqual([0, 5, 10]);
  });

  it("rejects malformed delay schedules", () => {
    expect(() => loadConfig({ WEBHOOK_RETRY_DELAYS_MS: "0,nope" })).toThrow(/WEBHOOK_RETRY_DELAYS_MS/);
  });
});
