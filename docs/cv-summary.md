# CV summary

## HookED — Reliable Webhook Delivery Service

**TypeScript, Node.js, Fastify, PostgreSQL, Redis, BullMQ, Zod, Vitest, Docker**

- Built an asynchronous webhook delivery service with HMAC signing, database-backed idempotent event ingestion, configurable retries, timeouts, replay, and per-attempt delivery history.
- Designed separate API and worker processes around PostgreSQL and Redis/BullMQ, using a transactional outbox to recover safely from database-to-queue publication failures.
- Added SSRF protections with DNS validation and connection pinning, payload limits, structured redacted logs, OpenAPI documentation, and consistent error responses.
- Tested concurrent idempotency, retry-to-success, signatures, replay, and dead-letter behavior against real PostgreSQL and Redis services in CI.

## Short description

Self-hostable webhook delivery backend that demonstrates reliable asynchronous processing and the failure cases around HTTP callbacks.
