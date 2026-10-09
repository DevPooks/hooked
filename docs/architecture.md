# Architecture

## Scope

HookED is intentionally a delivery service, not an event broker or customer-facing SaaS. Its job is to accept an event, derive deliveries for active endpoints, and preserve enough state to retry and explain the outcome.

## Components

### API process

Fastify handles validation, request IDs, payload limits, and the HTTP contract. It writes applications, endpoints, events, deliveries, idempotency records, and outbox entries. It does not call destination endpoints.

Fastify was chosen for its small runtime overhead, structured Pino logging, lifecycle hooks, and schema-based OpenAPI support. Zod performs domain validation at the route boundary.

### PostgreSQL

PostgreSQL is the source of truth. Foreign keys preserve relationships; unique `(application_id, key)` rows enforce idempotency; indexes support event history and schedulable delivery queries. Individual attempts are append-only.

### Transactional outbox

Accepting an event changes PostgreSQL and eventually Redis. Those systems cannot share a normal database transaction. HookED therefore creates outbox rows in the same transaction as deliveries. A publisher locks unpublished rows with `FOR UPDATE SKIP LOCKED`, adds deterministic BullMQ jobs, and marks each row published.

If publication fails before the database commit, the row stays unpublished. If Redis accepts a job but the commit fails, the deterministic job ID prevents another logical job from being added when the row is retried.

Retries and manual replay also create outbox rows. This avoids an unreliable “update the database, then hope queue publication succeeds” sequence.

### Redis and BullMQ

Redis holds short-lived delivery jobs and coordinates workers. BullMQ provides bounded concurrency, delayed availability, and duplicate-resistant job IDs. PostgreSQL—not Redis—keeps business history, so clearing the queue does not erase delivery records.

### Worker

A worker atomically changes an eligible delivery from `pending` or `retrying` to `processing` and increments counters. It resolves and validates the endpoint, sends one signed HTTP request, writes a `delivery_attempts` row, and moves the delivery to its next state.

Multiple workers can safely receive the same logical delivery: only one can claim the eligible status. A recovery loop returns stale `processing` records to the outbox after a worker crash.

## Consistency boundaries

Event ingestion is atomic across:

1. the event;
2. all current active-endpoint deliveries;
3. optional idempotency state; and
4. outbox rows.

HTTP delivery can never be exactly once because a worker may lose its connection after the receiver commits but before HookED records the response. HookED offers at-least-once delivery and stable event IDs so receivers can deduplicate.

## Failure behavior

| Failure | Result |
|---|---|
| API dies before commit | Nothing is accepted |
| API dies after commit | Outbox publisher discovers pending rows |
| Redis unavailable | Outbox remains unpublished and is retried |
| Worker dies before claim | BullMQ can give the job to another worker |
| Worker dies after claim | Stale-delivery recovery schedules it again |
| Destination returns `500` | Durable retry is scheduled |
| Destination returns `400` | Delivery becomes `failed` |
| Retry budget is exhausted | Delivery becomes `dead` |

## Deliberate tradeoffs

- Secrets are plaintext in PostgreSQL for clarity; production should use envelope encryption.
- Outbox polling is simple and observable but adds up to one poll interval of latency.
- A completed HTTP call interrupted by worker failure may be delivered twice. Receiver idempotency is still required.
- Attempt response bodies are discarded to reduce accidental storage of sensitive data.
