import { describe, expect, it } from "vitest";

import { PolicyContext, computePolicyDigest } from "../src/policy";

describe("policy", () => {
  it("computes grace deadline and checks window", () => {
    const activated = new Date("2024-01-01T00:00:00Z");
    const context = new PolicyContext(2, activated, 86_400_000); // 1 day
    expect(context.graceDeadline()?.toISOString()).toBe("2024-01-02T00:00:00.000Z");
    expect(context.isWithinGrace(new Date("2024-01-01T12:00:00Z"))).toBe(true);
    expect(context.isWithinGrace(new Date("2024-01-03T00:00:00Z"))).toBe(false);
  });

  it("throws when policy version mismatches", () => {
    const context = new PolicyContext(1);
    expect(() => context.requireVersion(2)).toThrow(/policy version mismatch/);
  });

  it("computes policy digest", () => {
    const digest = computePolicyDigest(Buffer.from("spec"), 4);
    expect(digest.version).toBe(4);
    expect(digest.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
