import { describe, expect, it } from "vitest";
import { ONE_DAY_SECONDS } from "./retention.js";

describe("ONE_DAY_SECONDS", () => {
  it("is 86400", () => {
    expect(ONE_DAY_SECONDS).toBe(86400);
  });
});
