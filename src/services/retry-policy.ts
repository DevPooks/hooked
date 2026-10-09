export const DEFAULT_BACKOFF_MS = [0, 30_000, 120_000, 600_000, 1_800_000] as const;

export function retryDelay(attemptNumber: number, schedule: readonly number[] = DEFAULT_BACKOFF_MS): number {
  if (attemptNumber < 1) throw new Error("attemptNumber must be positive");
  return schedule[Math.min(attemptNumber, schedule.length - 1)] ?? schedule.at(-1) ?? 0;
}

export function shouldRetryStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}
