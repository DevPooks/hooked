import type { Config } from "../config/env.js";
import type { Database } from "../db/pool.js";
import { createId } from "../domain/ids.js";
import { deliverWebhook } from "../services/http-delivery.js";
import { retryDelay } from "../services/retry-policy.js";
import { claimDelivery } from "../services/store.js";

interface DeliveryLogger {
  info(bindings: Record<string, unknown>, message: string): void;
}

export async function processDelivery(input: {
  database: Database;
  config: Config;
  logger: DeliveryLogger;
  deliveryId: string;
}): Promise<void> {
  const client = await input.database.connect();
  let claimed;
  try {
    await client.query("BEGIN");
    claimed = await claimDelivery(client, input.deliveryId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (claimed === null) return;

  const startedAt = new Date();
  const result = await deliverWebhook({
    endpointUrl: claimed.endpoint_url,
    secret: claimed.secret,
    event: { id: claimed.event_id, type: claimed.event_type, created_at: claimed.event_created_at.toISOString(), data: claimed.event_data },
    timeoutMs: input.config.webhookTimeoutMs,
    allowPrivate: input.config.allowPrivateEndpoints,
  });
  const completedAt = new Date();
  const canRetry = result.retryable && claimed.cycle_attempt_count < input.config.webhookMaxAttempts;
  const nextDelay = canRetry ? retryDelay(claimed.cycle_attempt_count, input.config.webhookRetryDelaysMs) : 0;
  const status = result.ok ? "succeeded" : canRetry ? "retrying" : result.retryable ? "dead" : "failed";
  const writer = await input.database.connect();
  try {
    await writer.query("BEGIN");
    await writer.query(
      `INSERT INTO delivery_attempts
       (id, delivery_id, attempt_number, started_at, completed_at, http_status, duration_ms, error_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [createId("att"), claimed.id, claimed.attempt_count, startedAt, completedAt, result.statusCode, result.durationMs, result.errorCategory],
    );
    await writer.query(
      `UPDATE deliveries SET status = $2, next_attempt_at = $3, last_status_code = $4,
       last_error = $5, completed_at = $6, updated_at = NOW() WHERE id = $1`,
      [claimed.id, status, canRetry ? new Date(Date.now() + nextDelay) : null, result.statusCode, result.errorMessage, result.ok || !canRetry ? completedAt : null],
    );
    if (canRetry) {
      await writer.query("INSERT INTO outbox (delivery_id, available_at) VALUES ($1, $2)", [claimed.id, new Date(Date.now() + nextDelay)]);
    }
    await writer.query("COMMIT");
  } catch (error) {
    await writer.query("ROLLBACK");
    throw error;
  } finally {
    writer.release();
  }

  input.logger.info(
    { event_id: claimed.event_id, delivery_id: claimed.id, endpoint_id: claimed.endpoint_id, attempt: claimed.attempt_count, duration: result.durationMs, status, status_code: result.statusCode },
    "webhook delivery completed",
  );
}

export async function recoverStaleDeliveries(database: Database, staleAfterMs: number): Promise<number> {
  const result = await database.query(
    `WITH recovered AS (
       UPDATE deliveries SET status = 'retrying', next_attempt_at = NOW(), updated_at = NOW()
       WHERE status = 'processing' AND updated_at < NOW() - ($1 * INTERVAL '1 millisecond')
       RETURNING id
     )
     INSERT INTO outbox (delivery_id) SELECT id FROM recovered RETURNING delivery_id`,
    [staleAfterMs],
  );
  return result.rowCount ?? 0;
}
