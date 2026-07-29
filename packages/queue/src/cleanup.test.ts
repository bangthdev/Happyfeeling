import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import { startQueueCleanup } from "./cleanup.js";
import { ONE_DAY_SECONDS } from "./retention.js";

function fakeQueue(): { queue: Queue; clean: ReturnType<typeof vi.fn> } {
  const clean = vi.fn().mockResolvedValue([]);
  return { queue: { clean } as unknown as Queue, clean };
}

describe("startQueueCleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sweeps failed and completed jobs older than the retention window immediately on start", async () => {
    const { queue, clean } = fakeQueue();

    const stop = startQueueCleanup(queue, 60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(clean).toHaveBeenCalledWith(ONE_DAY_SECONDS * 1000, 1000, "failed");
    expect(clean).toHaveBeenCalledWith(
      ONE_DAY_SECONDS * 1000,
      1000,
      "completed",
    );

    stop();
  });

  it("sweeps again after the interval elapses", async () => {
    const { queue, clean } = fakeQueue();
    const intervalMs = 60 * 60 * 1000;

    const stop = startQueueCleanup(queue, intervalMs);
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterStart = clean.mock.calls.length;

    await vi.advanceTimersByTimeAsync(intervalMs);

    expect(clean.mock.calls.length).toBeGreaterThan(callsAfterStart);
    stop();
  });

  it("stops sweeping once the returned stop function is called", async () => {
    const { queue, clean } = fakeQueue();
    const intervalMs = 60 * 60 * 1000;

    const stop = startQueueCleanup(queue, intervalMs);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const callsAfterStop = clean.mock.calls.length;

    await vi.advanceTimersByTimeAsync(intervalMs * 3);

    expect(clean.mock.calls.length).toBe(callsAfterStop);
  });

  it("logs and keeps running on the next interval if a sweep fails", async () => {
    const clean = vi.fn().mockRejectedValueOnce(new Error("redis down"));
    const queue = { clean } as unknown as Queue;
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const intervalMs = 60 * 60 * 1000;

    const stop = startQueueCleanup(queue, intervalMs);
    await vi.advanceTimersByTimeAsync(0);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Queue cleanup sweep failed:",
      expect.any(Error),
    );

    clean.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(intervalMs);
    expect(clean.mock.calls.length).toBeGreaterThan(1);

    stop();
    consoleErrorSpy.mockRestore();
  });
});

describe("startQueueCleanup (real timers)", () => {
  it("un-refs the interval timer so it doesn't keep a short-lived process alive on its own", () => {
    const { queue } = fakeQueue();
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const stop = startQueueCleanup(queue, 60 * 60 * 1000);

    const timer = setIntervalSpy.mock.results[0]?.value;
    expect(timer?.hasRef?.()).toBe(false);

    stop();
    setIntervalSpy.mockRestore();
  });
});
