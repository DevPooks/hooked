import type { FastifyInstance } from "fastify";
import type { Config } from "../config/env.js";
import type { Database } from "../db/pool.js";
import { AppError } from "../domain/errors.js";
import { resolveEndpoint } from "../security/endpoint-url.js";
import {
  createApplication,
  createEndpoint,
  createEvent,
  deleteEndpoint,
  getApplication,
  getDelivery,
  getEvent,
  getEventDeliveries,
  listEndpoints,
  replayDelivery,
} from "../services/store.js";
import { applicationBody, endpointBody, eventBody, idParams, parseOrThrow } from "./schemas.js";

const tags = {
  applications: ["Applications"],
  endpoints: ["Endpoints"],
  events: ["Events"],
  deliveries: ["Deliveries"],
};
const idParameterSchema = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 5, maxLength: 80 } } } as const;
const errorResponses = {
  200: { description: "Success" },
  201: { description: "Created" },
  202: { description: "Accepted for asynchronous delivery" },
  204: { description: "No content" },
  400: { description: "Invalid request" },
  404: { description: "Resource not found" },
  409: { description: "State or idempotency conflict" },
} as const;

export async function registerRoutes(app: FastifyInstance, input: { database: Database; config: Config }): Promise<void> {
  app.post("/api/v1/applications", { schema: { tags: tags.applications, summary: "Create an application", body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 } } }, response: errorResponses } }, async (request, reply) => {
    const body = parseOrThrow(applicationBody, request.body);
    return reply.code(201).send(await createApplication(input.database, body.name));
  });

  app.get("/api/v1/applications/:id", { schema: { tags: tags.applications, summary: "Get an application", params: idParameterSchema, response: errorResponses } }, async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    return getApplication(input.database, id);
  });

  app.post("/api/v1/applications/:id/endpoints", { schema: { tags: tags.endpoints, summary: "Create an endpoint; its secret is returned once", params: idParameterSchema, body: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string", format: "uri", maxLength: 2048 } } }, response: errorResponses } }, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(endpointBody, request.body);
    try {
      await resolveEndpoint(body.url, input.config.allowPrivateEndpoints);
    } catch {
      throw new AppError(400, "INVALID_ENDPOINT_URL", "Endpoint URL is not allowed.");
    }
    return reply.code(201).send(await createEndpoint(input.database, id, body.url));
  });

  app.get("/api/v1/applications/:id/endpoints", { schema: { tags: tags.endpoints, summary: "List endpoints", params: idParameterSchema, response: errorResponses } }, async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    return { data: await listEndpoints(input.database, id) };
  });

  app.delete("/api/v1/endpoints/:id", { schema: { tags: tags.endpoints, summary: "Deactivate an endpoint", params: idParameterSchema, response: errorResponses } }, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    await deleteEndpoint(input.database, id);
    return reply.code(204).send();
  });

  app.post("/api/v1/applications/:id/events", { schema: { tags: tags.events, summary: "Submit an event", description: "Use Idempotency-Key to safely retry the same request.", params: idParameterSchema, headers: { type: "object", properties: { "idempotency-key": { type: "string", minLength: 1, maxLength: 200, description: "Unique within an application" } } }, body: { type: "object", additionalProperties: false, required: ["type", "data"], properties: { type: { type: "string", minLength: 1, maxLength: 120, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" }, data: {} } }, response: errorResponses } }, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(eventBody, request.body);
    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (idempotencyKey !== undefined && (idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
      throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must contain between 1 and 200 characters.");
    }
    const result = await createEvent(input.database, id, body, idempotencyKey);
    return reply.code(result.duplicate ? 200 : 202).send(result);
  });

  app.get("/api/v1/events/:id", { schema: { tags: tags.events, summary: "Get an event", params: idParameterSchema, response: errorResponses } }, async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    return getEvent(input.database, id);
  });

  app.get("/api/v1/events/:id/deliveries", { schema: { tags: tags.deliveries, summary: "List an event's deliveries and attempts", params: idParameterSchema, response: errorResponses } }, async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    return { data: await getEventDeliveries(input.database, id) };
  });

  app.get("/api/v1/deliveries/:id", { schema: { tags: tags.deliveries, summary: "Get delivery history", params: idParameterSchema, response: errorResponses } }, async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    return getDelivery(input.database, id);
  });

  app.post("/api/v1/deliveries/:id/replay", { schema: { tags: tags.deliveries, summary: "Replay a completed delivery", params: idParameterSchema, response: errorResponses } }, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    return reply.code(202).send(await replayDelivery(input.database, id, input.config.replayCooldownMs));
  });
}
