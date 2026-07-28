import { Redis } from "ioredis";
import { loadRootEnv } from "@happyfeeling/config";

loadRootEnv(import.meta.url);

export function createRedisConnection(): Redis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, { maxRetriesPerRequest: null });
}
