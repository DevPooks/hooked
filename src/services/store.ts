import { createHash, randomBytes } from "node:crypto";
import type { Database, DatabaseClient } from "../db/pool.js";
import { AppError } from "../domain/errors.js";
import { createId } from "../domain/ids.js";

export interface EventInput {
  type: string;
  data: unknown;
}

export async function createApplication(database: Database, name: string) {
  const id = createId("app");
  const result = await database.query("INSERT INTO applications (id, name) VALUES ($1, $2) RETURNING id, name, created_at", [id, name]);
  return result.rows[0];
}

export async function getApplication(database: Database, id: string) {
  const result = await database.query("SELECT id, name, created_at FROM applications WHERE id = $1", [id]);
  if (result.rowCount === 0) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found.");
  return result.rows[0];
}

export async function createEndpoint(database: Database, applicationId: string, url: string) {
  await getApplication(database, applicationId);
  const id = createId("ep");
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const result = await database.query(
    "INSERT INTO endpoints (id, application_id, url, secret) VALUES ($1, $2, $3, $4) RETURNING id, application_id, url, active, created_at",
    [id, applicationId, url, secret],
  );
  return { ...result.rows[0], secret };
}

export async function listEndpoints(database: Database, applicationId: string) {
  await getApplication(database, applicationId);
  const result = await database.query(
    "SELECT id, application_id, url, active, created_at, deleted_at FROM endpoints WHERE application_id = $1 ORDER BY created_at",
    [applicationId],
  );
  return result.rows;
}

export async function deleteEndpoint(database: Database, id: string): Promise<void> {
  const result = await database.query("UPDATE endpoints SET active = FALSE, deleted_at = NOW() WHERE id = $1 AND active = TRUE", [id]);
  if (result.rowCount === 0) throw new AppError(404, "ENDPOINT_NOT_FOUND", "Active endpoint not found.");
}

export async function createEvent(database: Database, applicationId: string, input: EventInput, idempotencyKey?: string) {
  const client = await database.connect();
  const requestHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
  try {
    await client.query("BEGIN");
    if (idempotencyKey !== undefined) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${applicationId}:${idempotencyKey}`]);
      const existing = await client.query(
        `SELECT e.id, e.application_id, e.type, e.data, e.created_at, i.request_hash
         FROM idempotency_keys i JOIN events e ON e.id = i.event_id
         WHERE i.application_id = $1 AND i.key = $2`,
        [applicationId, idempotencyKey],
      );
      if (existing.rowCount !== 0) {
        const row = existing.rows[0];
        if (row.request_hash !== requestHash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different request.");
        await client.query("COMMIT");
        const event = {
          id: row.id,
          application_id: row.application_id,
          type: row.type,
          data: row.data,
          created_at: row.created_at,
        };
        return { event, duplicate: true, deliveryCount: await countDeliveries(database, row.id as string) };
      }
    }
    const application = await client.query("SELECT id FROM applications WHERE id = $1", [applicationId]);
    if (application.rowCount === 0) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found.");
    const eventId = createId("evt");
    const inserted = await client.query(
      "INSERT INTO events (id, application_id, type, data) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, application_id, type, data, created_at",
      [eventId, applicationId, input.type, JSON.stringify(input.data)],
    );
    const endpoints = await client.query<{ id: string }>("SELECT id FROM endpoints WHERE application_id = $1 AND active = TRUE ORDER BY id", [applicationId]);
    for (const endpoint of endpoints.rows) {
      const deliveryId = createId("del");
      await client.query("INSERT INTO deliveries (id, event_id, endpoint_id, status) VALUES ($1, $2, $3, 'pending')", [deliveryId, eventId, endpoint.id]);
      await client.query("INSERT INTO outbox (delivery_id) VALUES ($1)", [deliveryId]);
    }
    if (idempotencyKey !== undefined) {
      await client.query("INSERT INTO idempotency_keys (application_id, key, request_hash, event_id) VALUES ($1, $2, $3, $4)", [
        applicationId,
        idempotencyKey,
        requestHash,
        eventId,
      ]);
    }
    await client.query("COMMIT");
    return { event: inserted.rows[0], duplicate: false, deliveryCount: endpoints.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getEvent(database: Database, id: string) {
  const result = await database.query("SELECT id, application_id, type, data, created_at FROM events WHERE id = $1", [id]);
  if (result.rowCount === 0) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
  return result.rows[0];
}

export async function getEventDeliveries(database: Database, eventId: string) {
  await getEvent(database, eventId);
  const deliveries = await database.query(
    `SELECT d.id, d.event_id, d.endpoint_id, ep.url AS endpoint_url, d.status, d.attempt_count,
            d.replay_count, d.next_attempt_at, d.last_status_code, d.last_error,
            d.completed_at, d.created_at, d.updated_at
     FROM deliveries d JOIN endpoints ep ON ep.id = d.endpoint_id
     WHERE d.event_id = $1 ORDER BY d.created_at, d.id`,
    [eventId],
  );
  return Promise.all(deliveries.rows.map(async (delivery) => ({ ...delivery, attempts: await getAttempts(database, delivery.id as string) })));
}

export async function getDelivery(database: Database, id: string) {
  const result = await database.query(
    `SELECT d.id, d.event_id, d.endpoint_id, ep.url AS endpoint_url, d.status, d.attempt_count,
            d.replay_count, d.next_attempt_at, d.last_status_code, d.last_error,
            d.completed_at, d.created_at, d.updated_at
     FROM deliveries d JOIN endpoints ep ON ep.id = d.endpoint_id WHERE d.id = $1`,
    [id],
  );
  if (result.rowCount === 0) throw new AppError(404, "DELIVERY_NOT_FOUND", "Delivery not found.");
  return { ...result.rows[0], attempts: await getAttempts(database, id) };
}

export async function replayDelivery(database: Database, id: string, cooldownMs: number) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ status: string; updated_at: Date }>("SELECT status, updated_at FROM deliveries WHERE id = $1 FOR UPDATE", [id]);
    if (result.rowCount === 0) throw new AppError(404, "DELIVERY_NOT_FOUND", "Delivery not found.");
    const row = result.rows[0];
    if (row === undefined) throw new AppError(404, "DELIVERY_NOT_FOUND", "Delivery not found.");
    if (["pending", "processing", "retrying"].includes(row.status)) throw new AppError(409, "DELIVERY_NOT_REPLAYABLE", "Delivery is already active.");
    if (Date.now() - row.updated_at.getTime() < cooldownMs) throw new AppError(429, "REPLAY_COOLDOWN", "Delivery was replayed or completed too recently.");
    await client.query(
      `UPDATE deliveries SET status = 'pending', cycle_attempt_count = 0, replay_count = replay_count + 1,
       next_attempt_at = NULL, completed_at = NULL, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    await client.query("INSERT INTO outbox (delivery_id) VALUES ($1)", [id]);
    await client.query("COMMIT");
    return getDelivery(database, id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getAttempts(database: Database, deliveryId: string) {
  const result = await database.query(
    `SELECT id, attempt_number, started_at, completed_at, http_status, duration_ms, error_category
     FROM delivery_attempts WHERE delivery_id = $1 ORDER BY attempt_number`,
    [deliveryId],
  );
  return result.rows;
}

async function countDeliveries(database: Database, eventId: string): Promise<number> {
  const result = await database.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM deliveries WHERE event_id = $1", [eventId]);
  return Number(result.rows[0]?.count ?? 0);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export interface ClaimedDelivery {
  id: string;
  endpoint_id: string;
  endpoint_url: string;
  secret: string;
  attempt_count: number;
  cycle_attempt_count: number;
  event_id: string;
  event_type: string;
  event_data: unknown;
  event_created_at: Date;
}

export async function claimDelivery(client: DatabaseClient, deliveryId: string): Promise<ClaimedDelivery | null> {
  const result = await client.query<ClaimedDelivery>(
    `UPDATE deliveries SET status = 'processing', attempt_count = attempt_count + 1,
       cycle_attempt_count = cycle_attempt_count + 1, updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'retrying')
     RETURNING id, endpoint_id, attempt_count, cycle_attempt_count,
       (SELECT url FROM endpoints WHERE endpoints.id = deliveries.endpoint_id) AS endpoint_url,
       (SELECT secret FROM endpoints WHERE endpoints.id = deliveries.endpoint_id) AS secret,
       event_id,
       (SELECT type FROM events WHERE events.id = deliveries.event_id) AS event_type,
       (SELECT data FROM events WHERE events.id = deliveries.event_id) AS event_data,
       (SELECT created_at FROM events WHERE events.id = deliveries.event_id) AS event_created_at`,
    [deliveryId],
  );
  return result.rows[0] ?? null;
}
