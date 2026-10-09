import { Queue } from "bullmq";
import type { DeliveryJob } from "../domain/types.js";

export const DELIVERY_QUEUE = "hooked-deliveries";

export function createDeliveryQueue(redisUrl: string): Queue<DeliveryJob> {
  return new Queue<DeliveryJob>(DELIVERY_QUEUE, {
    connection: { url: redisUrl },
    defaultJobOptions: { attempts: 1, removeOnComplete: 1_000, removeOnFail: 5_000 },
  });
}
