import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logMetrics } from "./logger.js";

describe("logMetrics", () => {
  const tmpFile = path.join(os.tmpdir(), `metrics-test-${process.pid}.log`);

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it("logs to console and appends a JSON line to the log file", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const metrics = {
      pr_number: 12,
      findings_count: 2,
      skipped_count: 0,
      severity_breakdown: { high: 1, medium: 1 },
      latency_ms: 100,
      tokens_used: 500,
    };

    logMetrics(metrics, tmpFile);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(metrics));
    const fileContent = fs.readFileSync(tmpFile, "utf8");
    expect(fileContent.trim()).toBe(JSON.stringify(metrics));

    consoleSpy.mockRestore();
  });
});
