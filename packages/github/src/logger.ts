import fs from "node:fs";
import path from "node:path";

export interface Metrics {
  pr_number: number;
  findings_count: number;
  severity_breakdown: Record<string, number>;
  latency_ms: number;
  tokens_used: number;
}

export function logMetrics(
  metrics: Metrics,
  logFilePath = "logs/metrics.log",
): void {
  const line = JSON.stringify(metrics);
  console.log(line);

  const dir = path.dirname(logFilePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(logFilePath, line + "\n");
}
