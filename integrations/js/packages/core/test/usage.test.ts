import { describe, expect, it } from "vitest";
import { UsageTracker, enrichResponse, wrapIterable } from "../src";

describe("UsageTracker", () => {
  it("counts bytes and usage", () => {
    const tracker = new UsageTracker();
    tracker.addChunk(Buffer.from("hello"));
    tracker.addChunk(Buffer.from("world"));
    tracker.setUsage({ tokens: 5 });
    tracker.setFinalPrice(0.42);
    const report = tracker.build();

    expect(report.responseBytes).toBe(10);
    expect(report.usage.tokens).toBe(5);
    expect(report.finalPrice).toBe(0.42);
  });
});

describe("usage helpers", () => {
  it("wraps body with usage report", () => {
    const { body, report } = enrichResponse(Buffer.from("payload"), { foo: "bar" }, 1.2);
    expect(body.toString()).toBe("payload");
    expect(report.usage.foo).toBe("bar");
    expect(report.responseBytes).toBe(7);
    expect(report.finalPrice).toBe(1.2);
  });

  it("wrapIterable counts chunks", () => {
    const tracker = new UsageTracker();
    const wrapped = wrapIterable([Buffer.from("ab"), Buffer.from("cd")], tracker);
    const collected = Array.from(wrapped)
      .map((chunk) => chunk.toString())
      .join("");
    expect(collected).toBe("abcd");
    expect(tracker.build().responseBytes).toBe(4);
  });
});
