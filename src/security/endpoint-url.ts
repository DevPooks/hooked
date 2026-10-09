import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "../domain/errors.js";

export interface ResolvedEndpoint {
  url: URL;
  address: string;
  family: 4 | 6;
}

export function parseEndpointUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, "INVALID_ENDPOINT_URL", "Endpoint URL is not valid.");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username !== "" || url.password !== "") {
    throw new AppError(400, "INVALID_ENDPOINT_URL", "Endpoint URL must use HTTP(S) and must not contain credentials.");
  }
  if (url.hostname === "") {
    throw new AppError(400, "INVALID_ENDPOINT_URL", "Endpoint URL must include a hostname.");
  }
  return url;
}

export async function resolveEndpoint(value: string, allowPrivate: boolean): Promise<ResolvedEndpoint> {
  const url = parseEndpointUrl(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowPrivate && (hostname === "localhost" || hostname.endsWith(".localhost"))) {
    throw new AppError(400, "PRIVATE_ENDPOINT_BLOCKED", "Private and loopback webhook destinations are disabled.");
  }
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => {
        throw new AppError(400, "ENDPOINT_DNS_FAILED", "Endpoint hostname could not be resolved.");
      });
  if (addresses.length === 0) {
    throw new AppError(400, "ENDPOINT_DNS_FAILED", "Endpoint hostname could not be resolved.");
  }
  if (!allowPrivate && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new AppError(400, "PRIVATE_ENDPOINT_BLOCKED", "Private, loopback, link-local, and metadata destinations are disabled.");
  }
  const selected = addresses[0];
  if (selected === undefined) throw new AppError(400, "ENDPOINT_DNS_FAILED", "Endpoint hostname could not be resolved.");
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export function isPrivateAddress(input: string): boolean {
  const value = input.toLowerCase().split("%")[0] ?? input.toLowerCase();
  if (value === "::" || value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  if (isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  const [first = -1, second = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  );
}
