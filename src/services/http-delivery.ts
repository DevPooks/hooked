import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import type { ErrorCategory } from "../domain/types.js";
import { resolveEndpoint } from "../security/endpoint-url.js";
import { signPayload } from "../security/signatures.js";

export interface OutgoingEvent {
  id: string;
  type: string;
  created_at: string;
  data: unknown;
}

export interface DeliveryResult {
  ok: boolean;
  retryable: boolean;
  statusCode: number | null;
  durationMs: number;
  errorCategory: ErrorCategory | null;
  errorMessage: string | null;
}

export async function deliverWebhook(input: {
  endpointUrl: string;
  secret: string;
  event: OutgoingEvent;
  timeoutMs: number;
  allowPrivate: boolean;
}): Promise<DeliveryResult> {
  const started = performance.now();
  let target;
  try {
    target = await resolveEndpoint(input.endpointUrl, input.allowPrivate);
  } catch (error) {
    return failure(started, false, null, "invalid_url", safeMessage(error));
  }
  const body = JSON.stringify(input.event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload(input.secret, timestamp, body);
  const client = target.url.protocol === "https:" ? https : http;
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, target.address, target.family);
  };

  return new Promise((resolve) => {
    const request = client.request(
      target.url,
      {
        method: "POST",
        lookup: pinnedLookup,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "HookED/0.1",
          "x-hooked-event-id": input.event.id,
          "x-hooked-timestamp": timestamp,
          "x-hooked-signature": signature,
        },
      },
      (response) => {
        response.resume();
        const statusCode = response.statusCode ?? 0;
        const durationMs = Math.round(performance.now() - started);
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ ok: true, retryable: false, statusCode, durationMs, errorCategory: null, errorMessage: null });
          return;
        }
        const retryable = statusCode === 408 || statusCode === 429 || statusCode >= 500;
        const errorCategory: ErrorCategory = statusCode === 429 ? "rate_limited" : statusCode >= 500 ? "http_5xx" : "http_4xx";
        resolve({ ok: false, retryable, statusCode, durationMs, errorCategory, errorMessage: `Destination returned HTTP ${statusCode}` });
      },
    );
    request.setTimeout(input.timeoutMs, () => request.destroy(Object.assign(new Error("Webhook request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", (error: NodeJS.ErrnoException) => {
      const category = classifyNetworkError(error);
      resolve(failure(started, category !== "invalid_url", null, category, safeMessage(error)));
    });
    request.end(body);
  });
}

export function classifyNetworkError(error: NodeJS.ErrnoException): ErrorCategory {
  switch (error.code) {
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return "timeout";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns";
    case "ECONNREFUSED":
    case "ECONNRESET":
      return "connection_refused";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "tls";
    case "ERR_INVALID_URL":
      return "invalid_url";
    default:
      return "unknown";
  }
}

function failure(started: number, retryable: boolean, statusCode: number | null, errorCategory: ErrorCategory, errorMessage: string): DeliveryResult {
  return { ok: false, retryable, statusCode, durationMs: Math.round(performance.now() - started), errorCategory, errorMessage };
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown delivery error";
}
