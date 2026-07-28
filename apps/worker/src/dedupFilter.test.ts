import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Finding } from "@b3-review/github/pipeline";
import { computeDedupHash } from "@b3-review/github/review/dedup";

vi.mock("@b3-review/db", () => ({
  prisma: {
    finding: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@b3-review/db";
import { filterNewFindings } from "./dedupFilter.js";

const REPO = "acme/widgets";
const PR = 7;

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/x.ts",
    line: 10,
    severity: "high",
    message: "bug",
    suggestion: "fix",
    ...overrides,
  };
}

function hashOf(f: Finding): string {
  return computeDedupHash(REPO, PR, f.file, f.line);
}

describe("filterNewFindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a finding never seen before, and does not bump lastSeenAt", async () => {
    vi.mocked(prisma.finding.findMany).mockResolvedValue([]);
    const f = finding();

    const result = await filterNewFindings(REPO, PR, [f]);

    expect(result).toEqual([f]);
    expect(prisma.finding.updateMany).not.toHaveBeenCalled();
  });

  it("drops a finding already seen before, and bumps its lastSeenAt", async () => {
    const f = finding();
    vi.mocked(prisma.finding.findMany).mockResolvedValue([
      { dedupHash: hashOf(f) },
    ] as never);

    const result = await filterNewFindings(REPO, PR, [f]);

    expect(result).toEqual([]);
    expect(prisma.finding.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.finding.updateMany).toHaveBeenCalledWith({
      where: { dedupHash: { in: [hashOf(f)] } },
      data: { lastSeenAt: expect.any(Date) },
    });
  });

  it("filters a mixed list down to only the never-seen findings, in one batched query", async () => {
    const seen = finding({ file: "src/seen.ts", line: 1 });
    const fresh = finding({ file: "src/fresh.ts", line: 2 });
    vi.mocked(prisma.finding.findMany).mockResolvedValue([
      { dedupHash: hashOf(seen) },
    ] as never);

    const result = await filterNewFindings(REPO, PR, [seen, fresh]);

    expect(result).toEqual([fresh]);
    expect(prisma.finding.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.finding.findMany).toHaveBeenCalledWith({
      where: { dedupHash: { in: [hashOf(seen), hashOf(fresh)] } },
      select: { dedupHash: true },
    });
  });

  it("drops a later finding in the same batch that shares the same file+line as an earlier one", async () => {
    vi.mocked(prisma.finding.findMany).mockResolvedValue([]);
    const first = finding({ message: "first report" });
    const duplicateInSameBatch = finding({
      message: "second report, same file+line",
    });

    const result = await filterNewFindings(REPO, PR, [
      first,
      duplicateInSameBatch,
    ]);

    expect(result).toEqual([first]);
    expect(prisma.finding.findMany).toHaveBeenCalledWith({
      where: { dedupHash: { in: [hashOf(first)] } },
      select: { dedupHash: true },
    });
  });

  it("keeps all findings (rather than losing any) when the batched DB check throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const a = finding({ file: "src/a.ts", line: 1 });
    const b = finding({ file: "src/b.ts", line: 2 });
    vi.mocked(prisma.finding.findMany).mockRejectedValue(
      new Error("connection reset"),
    );

    const result = await filterNewFindings(REPO, PR, [a, b]);

    expect(result).toEqual([a, b]);
    expect(prisma.finding.updateMany).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("still drops known-duplicate findings even when the lastSeenAt bump (updateMany) itself fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const seen = finding({ file: "src/seen.ts", line: 1 });
    const fresh = finding({ file: "src/fresh.ts", line: 2 });
    vi.mocked(prisma.finding.findMany).mockResolvedValue([
      { dedupHash: hashOf(seen) },
    ] as never);
    vi.mocked(prisma.finding.updateMany).mockRejectedValue(
      new Error("connection reset"),
    );

    const result = await filterNewFindings(REPO, PR, [seen, fresh]);

    expect(result).toEqual([fresh]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("returns an empty array without querying the DB when there are no findings", async () => {
    const result = await filterNewFindings(REPO, PR, []);

    expect(result).toEqual([]);
    expect(prisma.finding.findMany).not.toHaveBeenCalled();
  });
});
