# Interview notes

## What problem does HookED solve?

A webhook is an HTTP callback sent when something happens. Direct callbacks couple the original request to a remote system that may be slow or unavailable. HookED persists the event first and lets workers deliver it asynchronously, so the producer can respond quickly and failures become recoverable work.

## Why exponential backoff?

Immediate repeated requests can make an outage worse. Backoff gives a receiver time to recover and reduces load. HookED uses an explicit configurable schedule rather than an unbounded formula so operators can predict maximum delivery time.

## What does idempotency mean here?

If a client is unsure whether its request succeeded, it can submit the same body with the same key. PostgreSQL guarantees one event per `(application, key)`. The body hash prevents the same key from silently representing two different requests. An advisory transaction lock makes concurrent duplicates converge on the same row cleanly.

Delivery is still at least once, so receivers should also deduplicate using `X-HookED-Event-ID`.

## Why PostgreSQL and Redis?

PostgreSQL owns durable business state and consistency constraints. Redis/BullMQ is optimized for worker coordination and delayed jobs. Using each for its strength avoids treating a queue as permanent history or polling the main deliveries table as the only work scheduler.

## What does the transactional outbox solve?

Without an outbox, the API could commit an event and crash before publishing its job, leaving a delivery that never runs. The outbox row is committed with the delivery. A separate publisher can retry until Redis accepts it. Deterministic job IDs cover the opposite ambiguity: Redis accepted the job but PostgreSQL did not record publication.

## What if a worker crashes?

Before claim, BullMQ can make the job available again. After claim, the database says `processing`; a recovery loop moves stale rows back to `retrying` and adds a new outbox record. The interrupted attempt consumes retry budget because the destination may already have processed it.

## Why store attempts separately?

The delivery row answers “where is it now?” while attempt rows answer “how did it get there?” Keeping both makes operational investigation possible without overloading a single mutable record.

## What does HMAC provide?

HMAC lets the receiver verify that someone holding the shared endpoint secret created the exact timestamp/body pair. It detects tampering and authenticates the sender. A timestamp window and event-ID deduplication are still necessary to resist replay.

## What is SSRF?

Server-side request forgery happens when an attacker makes a server call a target the attacker cannot reach directly, such as cloud metadata or an internal database. HookED blocks private ranges, validates all DNS answers, pins the checked address, disables redirects, and keeps private destinations opt-in for development.

## How are failures classified?

Timeout, DNS, refused connection, TLS, `429`, `4xx`, and `5xx` are recorded as separate categories. That is more useful than an arbitrary error string for dashboards and retry decisions. `408`, `429`, `5xx`, and network failures are considered transient; ordinary `4xx` is permanent.

## How are external systems tested?

Unit tests cover pure cryptography, retry, validation, and classification logic. Integration tests use real PostgreSQL and Redis plus an in-process HTTP receiver. The receiver returns `500` before `200`, enabling deterministic verification of queueing, retry, signatures, history, replay, dead state, and concurrent idempotency.

## Important tradeoffs

- Exactly-once HTTP delivery is not realistic; idempotent receivers are required.
- Plaintext secret storage favors clarity over production hardening.
- Polling the outbox is simpler than change-data capture but adds small latency.
- Rejecting redirects is conservative and may surprise endpoints that rely on them.
