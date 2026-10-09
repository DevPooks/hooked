import type { Queue } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../db/pool.js";
import type { DeliveryJob } from "../domain/types.js";

interface OutboxRow {
  id: string;
  delivery_id: string;
}

export async function publishOutboxBatch(database: Database, queue: Queue<DeliveryJob>, limit = 50): Promise<number> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<OutboxRow>(
      `SELECT id::text, delivery_id FROM outbox
       WHERE published_at IS NULL AND available_at <= NOW()
       ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1`,
      [limit],
    );
    for (const row of result.rows) {
      await queue.add("deliver", { deliveryId: row.delivery_id }, { jobId: `outbox-${row.id}` });
      await client.query("UPDATE outbox SET published_at = NOW() WHERE id = $1", [row.id]);
    }
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function startOutboxPublisher(input: {
  database: Database;
  queue: Queue<DeliveryJob>;
  intervalMs: number;
  logger: FastifyBaseLogger;
}): () => Promise<void> {
  let running = false;
  const publish = async () => {
    if (running) return;
    running = true;
    try {
      let published: number;
      do {
        published = await publishOutboxBatch(input.database, input.queue);
      } while (published === 50);
    } catch (error) {
      input.logger.error({ err: error }, "outbox publication failed");
    } finally {
      running = false;
    }
  };
  void publish();
  const timer = setInterval(() => void publish(), input.intervalMs);
  timer.unref();
  return async () => clearInterval(timer);
}
