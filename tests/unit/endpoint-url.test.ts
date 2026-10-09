import { describe, expect, it } from "vitest";
import { isPrivateAddress, parseEndpointUrl, resolveEndpoint } from "../../src/security/endpoint-url.js";

describe("endpoint URL security", () => {
  it.each(["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.8", "169.254.169.254", "::1", "fd00::1"])("recognizes %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("recognizes %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("rejects credentials and non-HTTP protocols", () => {
    expect(() => parseEndpointUrl("file:///etc/passwd")).toThrow();
    expect(() => parseEndpointUrl("https://user:pass@example.com/hook")).toThrow();
  });

  it("blocks loopback unless explicitly enabled", async () => {
    await expect(resolveEndpoint("http://127.0.0.1:3100/success", false)).rejects.toMatchObject({ code: "PRIVATE_ENDPOINT_BLOCKED" });
    await expect(resolveEndpoint("http://127.0.0.1:3100/success", true)).resolves.toMatchObject({ address: "127.0.0.1" });
  });
});
