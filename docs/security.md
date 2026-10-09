# Security

## HMAC signatures

Each endpoint receives a random 256-bit secret when it is created. HookED returns the secret once and does not include it in later endpoint responses or logs.

For each request, HookED serializes the event payload, records the current Unix timestamp, and signs:

```text
timestamp + "." + raw_body
```

The result is sent as `X-HookED-Signature: v1=<hex>`.

### Receiver verification

Use the exact bytes received, not a parsed and re-serialized object. Also enforce a timestamp tolerance to reduce replay risk.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret: string, timestamp: string, rawBody: Buffer, supplied: string) {
  const expected = `v1=${createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
```

The receiver should store processed event IDs if duplicate effects would be harmful. A valid signature authenticates HookED; it does not guarantee one-time delivery.

## SSRF controls

User-selected webhook URLs create server-side request forgery risk. HookED:

- accepts only `http:` and `https:`;
- rejects embedded URL credentials;
- resolves the hostname before every attempt;
- rejects localhost, private IPv4, loopback, link-local, carrier-grade NAT, reserved multicast, unique-local IPv6, and `169.254.169.254`;
- rejects the destination if any returned DNS address is private; and
- pins the outgoing connection to the checked address while retaining the hostname for TLS verification.

`ALLOW_PRIVATE_ENDPOINTS=true` bypasses the network-range control for local development. It must not be enabled on an internet-facing deployment.

These controls reduce common DNS-rebinding attacks. A hardened deployment should also enforce outbound firewall or proxy policy because application checks are not a substitute for network isolation.

## Timeouts and redirects

Every delivery has a configurable hard timeout. Redirects are not followed, which prevents a validated public URL from redirecting the worker to a private target.

## Payload and logging policy

The default inbound body limit is 256 KB. Structured logs include IDs, attempt number, latency, and result. They redact authorization/cookie headers and do not log endpoint secrets or event payloads. Destination response bodies are not stored.

## Replay protection

Manual replay is allowed only for completed deliveries and has a configurable cooldown. This protects against accidental rapid repeats; API authentication and per-principal rate limiting are required before exposing replay in a multi-user environment.

## Known limitation: secret storage

Endpoint secrets are stored in plaintext so a worker can sign deliveries. This is acceptable for a transparent educational implementation, not for a mature production service. A production design should encrypt each secret with a data key protected by a cloud KMS, audit decryption, and support rotation.

## Deployment checklist

- Keep `ALLOW_PRIVATE_ENDPOINTS=false`.
- Add authentication in front of the API.
- Use TLS for PostgreSQL, Redis, and public API traffic.
- Restrict worker egress at the network layer.
- Replace default database credentials.
- Encrypt endpoint secrets and back up PostgreSQL.
- Monitor dead deliveries and outbox age.
