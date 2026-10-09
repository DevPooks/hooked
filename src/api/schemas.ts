import { z } from "zod";

export const idParams = z.object({ id: z.string().min(5).max(80) });
export const applicationBody = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const endpointBody = z.object({ url: z.string().url().max(2_048) }).strict();
export const eventBody = z
  .object({
    type: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    data: z.unknown(),
  })
  .strict();

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues.map((issue) => issue.message).join("; "));
    Object.assign(error, { statusCode: 400, code: "VALIDATION_ERROR" });
    throw error;
  }
  return result.data;
}
