import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { Redis } from "ioredis";
import type { Config } from "../config/env.js";
import { createDatabase } from "../db/pool.js";
import { AppError } from "../domain/errors.js";
import { startOutboxPublisher } from "../jobs/outbox.js";
import { createDeliveryQueue } from "../jobs/queue.js";
import { registerRoutes } from "./routes.js";

export async function buildServer(config: Config) {
  const app = Fastify({
    bodyLimit: config.maxPayloadBytes,
    logger: { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie", "body", "secret"] },
    genReqId(request) {
      const supplied = request.headers["x-request-id"];
      return typeof supplied === "string" && supplied.length <= 100 ? supplied : crypto.randomUUID();
    },
  });
  const database = createDatabase(config.databaseUrl);
  const queue = createDeliveryQueue(config.redisUrl);
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

  await app.register(swagger, {
    openapi: {
      info: { title: "HookED API", description: "Durable, signed webhook delivery API.", version: "0.1.0" },
      tags: [{ name: "Applications" }, { name: "Endpoints" }, { name: "Events" }, { name: "Deliveries" }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.addHook("onSend", async (request, reply, payload) => {
    void reply.header("x-request-id", request.id);
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const caught = error as Error & { statusCode?: number; code?: string; validation?: unknown };
    const statusCode = error instanceof AppError ? error.statusCode : typeof caught.statusCode === "number" ? caught.statusCode : 500;
    const code =
      error instanceof AppError
        ? error.code
        : caught.validation !== undefined
          ? "VALIDATION_ERROR"
          : statusCode === 413
            ? "PAYLOAD_TOO_LARGE"
            : caught.code ?? "INTERNAL_ERROR";
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    return reply.code(statusCode).send({ error: { code, message: statusCode >= 500 ? "An internal error occurred." : caught.message }, request_id: request.id });
  });

  app.get("/health", { schema: { tags: ["Operations"], summary: "Check API, PostgreSQL, and Redis" } }, async (_request, reply) => {
    const checks = { api: "ok", postgresql: "ok", redis: "ok" };
    try {
      await database.query("SELECT 1");
    } catch {
      checks.postgresql = "unavailable";
    }
    try {
      if (redis.status === "wait") await redis.connect();
      await redis.ping();
    } catch {
      checks.redis = "unavailable";
    }
    const ok = checks.postgresql === "ok" && checks.redis === "ok";
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", checks });
  });
  await registerRoutes(app, { database, config });
  const stopPublisher = startOutboxPublisher({ database, queue, intervalMs: config.outboxPollIntervalMs, logger: app.log });
  app.addHook("onClose", async () => {
    await stopPublisher();
    await queue.close();
    redis.disconnect();
    await database.end();
  });
  return app;
}
