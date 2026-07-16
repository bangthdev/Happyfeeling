import { prisma } from "./client.js";

async function main() {
  await prisma.config.upsert({
    where: { key: "filter.confidenceThreshold" },
    update: { value: "0.8" },
    create: { key: "filter.confidenceThreshold", value: "0.8" },
  });

  await prisma.ticket.upsert({
    where: { ticketId: "AIC-23" },
    update: { status: "seeded" },
    create: { ticketId: "AIC-23", status: "seeded" },
  });

  console.log("Seed hoàn tất.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
