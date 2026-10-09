import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgresql://hooked:hooked@localhost:5432/hooked"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  WEBHOOK_RETRY_DELAYS_MS: z.string().default("0,30000,120000,600000,1800000"),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(262_144),
  ALLOW_PRIVATE_ENDPOINTS: booleanFromString,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(500),
  REPLAY_COOLDOWN_MS: z.coerce.number().int().min(0).max(3_600_000).default(5_000),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  redisUrl: string;
  port: number;
  webhookTimeoutMs: number;
  webhookMaxAttempts: number;
  webhookRetryDelaysMs: number[];
  maxPayloadBytes: number;
  allowPrivateEndpoints: boolean;
  logLevel: string;
  workerConcurrency: number;
  outboxPollIntervalMs: number;
  replayCooldownMs: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  const value = parsed.data;
  const retryDelays = value.WEBHOOK_RETRY_DELAYS_MS.split(",").map((part) => Number(part.trim()));
  if (retryDelays.length === 0 || retryDelays.some((delay) => !Number.isSafeInteger(delay) || delay < 0)) {
    throw new Error("Invalid configuration: WEBHOOK_RETRY_DELAYS_MS must be a comma-separated list of non-negative integers");
  }
  return {
    nodeEnv: value.NODE_ENV,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    port: value.PORT,
    webhookTimeoutMs: value.WEBHOOK_TIMEOUT_MS,
    webhookMaxAttempts: value.WEBHOOK_MAX_ATTEMPTS,
    webhookRetryDelaysMs: retryDelays,
    maxPayloadBytes: value.MAX_PAYLOAD_BYTES,
    allowPrivateEndpoints: value.ALLOW_PRIVATE_ENDPOINTS,
    logLevel: value.LOG_LEVEL,
    workerConcurrency: value.WORKER_CONCURRENCY,
    outboxPollIntervalMs: value.OUTBOX_POLL_INTERVAL_MS,
    replayCooldownMs: value.REPLAY_COOLDOWN_MS,
  };
}
