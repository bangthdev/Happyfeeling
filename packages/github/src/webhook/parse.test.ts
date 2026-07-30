import { describe, it, expect, vi } from "vitest";
import { parsePullRequestEvent } from "./parse.js";

const BASE_PAYLOAD = {
  action: "opened",
  repository: { name: "widgets", owner: { login: "acme" } },
  pull_request: {
    number: 7,
    base: { sha: "basesha1" },
    head: { sha: "sha1" },
  },
};

describe("parsePullRequestEvent", () => {
  it("parses an opened pull_request event", () => {
    const event = parsePullRequestEvent(BASE_PAYLOAD);
    expect(event).toEqual({
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      baseSha: "basesha1",
      headSha: "sha1",
      action: "opened",
    });
  });

  it("parses a synchronize pull_request event", () => {
    const event = parsePullRequestEvent({
      ...BASE_PAYLOAD,
      action: "synchronize",
    });
    expect(event?.action).toBe("synchronize");
  });

  it("returns null for irrelevant actions", () => {
    expect(
      parsePullRequestEvent({ ...BASE_PAYLOAD, action: "closed" }),
    ).toBeNull();
  });

  it("returns null for payloads missing pull_request", () => {
    expect(
      parsePullRequestEvent({
        action: "opened",
        repository: BASE_PAYLOAD.repository,
      }),
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parsePullRequestEvent(null)).toBeNull();
    expect(parsePullRequestEvent("string")).toBeNull();
  });

  it("returns null instead of throwing when repository.owner is missing", () => {
    expect(
      parsePullRequestEvent({
        ...BASE_PAYLOAD,
        repository: { name: "widgets" },
      }),
    ).toBeNull();
  });

  it("returns null instead of throwing when pull_request.base is missing", () => {
    expect(
      parsePullRequestEvent({
        ...BASE_PAYLOAD,
        pull_request: { number: 7, head: { sha: "sha1" } },
      }),
    ).toBeNull();
  });

  it("returns null instead of throwing when pull_request.head is missing", () => {
    expect(
      parsePullRequestEvent({
        ...BASE_PAYLOAD,
        pull_request: { number: 7, base: { sha: "basesha1" } },
      }),
    ).toBeNull();
  });

  it("logs when a relevant payload is missing owner/baseSha/headSha", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    parsePullRequestEvent({ ...BASE_PAYLOAD, repository: { name: "widgets" } });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("does not log for a legitimately irrelevant action", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    parsePullRequestEvent({ ...BASE_PAYLOAD, action: "closed" });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns null instead of building an event with an undefined repo when repository.name is missing", () => {
    expect(
      parsePullRequestEvent({
        ...BASE_PAYLOAD,
        repository: { owner: { login: "acme" } },
      }),
    ).toBeNull();
  });

  it("returns null instead of building an event with an undefined prNumber when pull_request.number is missing", () => {
    expect(
      parsePullRequestEvent({
        ...BASE_PAYLOAD,
        pull_request: {
          base: { sha: "basesha1" },
          head: { sha: "sha1" },
        },
      }),
    ).toBeNull();
  });
});
