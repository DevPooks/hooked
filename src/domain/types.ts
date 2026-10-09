export type DeliveryStatus = "pending" | "processing" | "succeeded" | "retrying" | "failed" | "dead";
export type ErrorCategory = "timeout" | "dns" | "connection_refused" | "tls" | "http_4xx" | "http_5xx" | "rate_limited" | "invalid_url" | "unknown";

export interface DeliveryJob {
  deliveryId: string;
}
