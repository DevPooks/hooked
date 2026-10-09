import { Worker } from "bullmq";
import pino from "pino";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/pool.js";
import { processDelivery, recoverStaleDeliveries } from "./jobs/process-delivery.js";
import { createDeliveryQueue, DELIVERY_QUEUE } from "./jobs/queue.js";

const config = loadConfig();
const logger = pino({ level: config.logLevel });
const database = createDatabase(config.databaseUrl);
const queue = createDeliveryQueue(config.redisUrl);
const worker = new Worker(
  DELIVERY_QUEUE,
  async (job) => processDelivery({ database, config, logger, deliveryId: job.data.deliveryId }),
  { connection: { url: config.redisUrl }, concurrency: config.workerConcurrency },
);

worker.on("failed", (job, error) => logger.error({ err: error, delivery_id: job?.data.deliveryId }, "delivery job failed"));
worker.on("error", (error) => logger.error({ err: error }, "worker error"));
logger.info({ concurrency: config.workerConcurrency }, "HookED worker started");
const recoveryTimer = setInterval(() => {
  void recoverStaleDeliveries(database, Math.max(config.webhookTimeoutMs * 2, 10_000)).catch((error: unknown) =>
    logger.error({ err: error }, "stale delivery recovery failed"),
  );
}, Math.max(config.webhookTimeoutMs * 2, 10_000));
recoveryTimer.unref();

async function shutdown(signal: string) {
  logger.info({ signal }, "stopping worker");
  clearInterval(recoveryTimer);
  await worker.close();
  await queue.close();
  await database.end();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
