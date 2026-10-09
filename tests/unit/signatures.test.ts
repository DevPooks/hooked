import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../../src/security/signatures.js";

describe("webhook signatures", () => {
  it("signs a canonical timestamp/body pair with HMAC-SHA256", () => {
    const signature = signPayload("test-secret", "1700000000", '{"ok":true}');
    expect(signature).toBe("v1=e00af05ced77fd14c24ad92b550cd513693939af637a094ea86bcfc6681451b0");
    expect(verifySignature("test-secret", "1700000000", '{"ok":true}', signature)).toBe(true);
    expect(verifySignature("test-secret", "1700000000", '{"ok":false}', signature)).toBe(false);
  });
});
