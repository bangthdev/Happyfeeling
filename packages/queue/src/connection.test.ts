import { describe, expect, it } from "vitest";
import { createRedisConnection } from "./connection.js";

describe("createRedisConnection", () => {
  it("connects to Redis and responds to PING", async () => {
    const connection = createRedisConnection();
    const result = await connection.ping();
    expect(result).toBe("PONG");
    await connection.quit();
  });
});
