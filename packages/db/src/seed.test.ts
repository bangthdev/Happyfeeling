import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seed", () => {
  it("seeds the confidence threshold config", async () => {
    const config = await prisma.config.findUnique({
      where: { key: "filter.confidenceThreshold" },
    });

    expect(config).not.toBeNull();
    expect(config?.value).toBe("0.8");
  });

  it("seeds the demo ticket", async () => {
    const ticket = await prisma.ticket.findUnique({
      where: { ticketId: "AIC-23" },
    });

    expect(ticket).not.toBeNull();
    expect(ticket?.status).toBe("seeded");
  });
});
