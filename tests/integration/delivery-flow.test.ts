import http from "node:http";
import { Worker } from "bullmq";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../src/api/server.js";
import { loadConfig, type Config } from "../../src/config/env.js";
import { migrate } from "../../src/db/migrate.js";
import { createDatabase } from "../../src/db/pool.js";
import { processDelivery } from "../../src/jobs/process-delivery.js";
import { createDeliveryQueue, DELIVERY_QUEUE } from "../../src/jobs/queue.js";
import { verifySignature } from "../../src/security/signatures.js";

const enabled = process.env.RUN_INTEGRATION === "true";
const suite = enabled ? describe : describe.skip;

suite("complete webhook flow", () => {
  const config: Config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://hooked:hooked@localhost:5432/hooked",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    ALLOW_PRIVATE_ENDPOINTS: "true",
    WEBHOOK_RETRY_DELAYS_MS: "0,10,20",
    WEBHOOK_MAX_ATTEMPTS: "3",
    OUTBOX_POLL_INTERVAL_MS: "50",
    REPLAY_COOLDOWN_MS: "0",
    LOG_LEVEL: "silent",
  });
  const database = createDatabase(config.databaseUrl);
  const queue = createDeliveryQueue(config.redisUrl);
  const receiverState: { attempts: number; body: string; headers: http.IncomingHttpHeaders } = { attempts: 0, body: "", headers: {} };
  const receiver = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      receiverState.attempts += 1;
      receiverState.body = Buffer.concat(chunks).toString("utf8");
      receiverState.headers = request.headers;
      const status = request.url === "/always-fail" || receiverState.attempts === 1 ? 500 : 200;
      response.writeHead(status, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  let app: Awaited<ReturnType<typeof buildServer>>;
  let worker: Worker;
  let receiverUrl: string;

  beforeAll(async () => {
    await migrate(database);
    await database.query("TRUNCATE applications CASCADE");
    await queue.drain(true);
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
    app = await buildServer(config);
    worker = new Worker(
      DELIVERY_QUEUE,
      async (job) => processDelivery({ database, config, logger: app.log, deliveryId: job.data.deliveryId }),
      { connection: { url: config.redisUrl }, concurrency: 2 },
    );
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await queue.close();
    await database.end();
    await new Promise<void>((resolve, reject) => receiver.close((error) => (error ? reject(error) : resolve())));
  });

  it("retries, signs, deduplicates, records history, and replays", async () => {
    const applicationResponse = await app.inject({ method: "POST", url: "/api/v1/applications", payload: { name: "Checkout" } });
    expect(applicationResponse.statusCode).toBe(201);
    const application = applicationResponse.json<{ id: string }>();

    const endpointResponse = await app.inject({ method: "POST", url: `/api/v1/applications/${application.id}/endpoints`, payload: { url: receiverUrl } });
    expect(endpointResponse.statusCode).toBe(201);
    const endpoint = endpointResponse.json<{ secret: string }>();

    const submissions = await Promise.all(
      [0, 1].map(() => app.inject({ method: "POST", url: `/api/v1/applications/${application.id}/events`, headers: { "idempotency-key": "checkout-42" }, payload: { type: "order.completed", data: { order_id: "ord_42" } } })),
    );
    expect(submissions.map((response) => response.statusCode).sort()).toEqual([200, 202]);
    const eventIds = submissions.map((response) => response.json<{ event: { id: string } }>().event.id);
    expect(new Set(eventIds).size).toBe(1);

    const delivery = await waitForDelivery(database, eventIds[0] ?? "", "succeeded");
    expect(delivery.attempt_count).toBe(2);
    expect(receiverState.headers["x-hooked-event-id"]).toBe(eventIds[0]);
    expect(verifySignature(endpoint.secret, String(receiverState.headers["x-hooked-timestamp"]), receiverState.body, String(receiverState.headers["x-hooked-signature"]))).toBe(true);

    const history = await app.inject({ method: "GET", url: `/api/v1/deliveries/${delivery.id}` });
    expect(history.json<{ attempts: unknown[] }>().attempts).toHaveLength(2);
    const replay = await app.inject({ method: "POST", url: `/api/v1/deliveries/${delivery.id}/replay` });
    expect(replay.statusCode).toBe(202);
    const replayed = await waitForDelivery(database, eventIds[0] ?? "", "succeeded", 3);
    expect(replayed.attempt_count).toBe(3);
    expect(replayed.replay_count).toBe(1);
  });

  it("moves a persistently failing delivery to dead state", async () => {
    const applicationResponse = await app.inject({ method: "POST", url: "/api/v1/applications", payload: { name: "Dead letter test" } });
    const application = applicationResponse.json<{ id: string }>();
    await app.inject({ method: "POST", url: `/api/v1/applications/${application.id}/endpoints`, payload: { url: `${receiverUrl}/always-fail` } });
    const eventResponse = await app.inject({ method: "POST", url: `/api/v1/applications/${application.id}/events`, payload: { type: "test.failure", data: {} } });
    const eventId = eventResponse.json<{ event: { id: string } }>().event.id;
    const delivery = await waitForDelivery(database, eventId, "dead", 3);
    expect(delivery.attempt_count).toBe(3);
  });
});

async function waitForDelivery(database: ReturnType<typeof createDatabase>, eventId: string, status: string, attempts = 2) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await database.query<{ id: string; status: string; attempt_count: number; replay_count: number }>(
      "SELECT id, status, attempt_count, replay_count FROM deliveries WHERE event_id = $1",
      [eventId],
    );
    const row = result.rows[0];
    if (row?.status === status && row.attempt_count >= attempts) return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Delivery did not reach ${status}`);
}
