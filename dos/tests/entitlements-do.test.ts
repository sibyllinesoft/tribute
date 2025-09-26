import { describe, expect, it, beforeEach } from "vitest";

import { EntitlementsDurableObject } from "../src/entitlements-do";

const createDO = () => {
  const store: Record<string, any> = {};
  const storage = {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, value: unknown) => {
      store[key] = value;
    },
  } as any;
  const durable = new EntitlementsDurableObject({ storage } as any);
  return { durable, store };
};

describe("EntitlementsDurableObject", () => {
  let durable: EntitlementsDurableObject;

  beforeEach(() => {
    durable = createDO().durable;
  });

  it("syncs features and quotas", async () => {
    const res = await durable.fetch(
      new Request("https://entitlements/sync", {
        method: "POST",
        body: JSON.stringify({
          userId: "user",
          merchantId: "merchant",
          features: [{ name: "pro", expiresAt: new Date(Date.now() + 1000).toISOString() }],
          quotas: { runs: { remaining: 3 } },
          fallbackMode: "block",
          upgradeUrl: "https://upgrade",
        }),
      })
    );
    expect(res.status).toBe(200);

    const stateRes = await durable.fetch(
      new Request("https://entitlements/user?userId=user&merchantId=merchant", { method: "GET" })
    );
    const body = await stateRes.json();
    expect(body.features.pro).toBeDefined();
    expect(body.quotas.runs.remaining).toBe(3);
    expect(body.fallbackMode).toBe("block");
  });

  it("denies when entitlements missing", async () => {
    const res = await durable.fetch(
      new Request("https://entitlements/access", {
        method: "POST",
        body: JSON.stringify({ userId: "user", merchantId: "merchant", feature: "pro" }),
      })
    );
    const decision = await res.json();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("entitlements_missing");
  });

  it("allows feature within expiry", async () => {
    const expiresAt = new Date(Date.now() + 1_000_000).toISOString();
    await durable.fetch(
      new Request("https://entitlements/sync", {
        method: "POST",
        body: JSON.stringify({
          userId: "user",
          merchantId: "merchant",
          features: [{ name: "pro", expiresAt }],
          fallbackMode: "metered",
        }),
      })
    );
    const accessRes = await durable.fetch(
      new Request("https://entitlements/access", {
        method: "POST",
        body: JSON.stringify({ userId: "user", merchantId: "merchant", feature: "pro" }),
      })
    );
    const decision = await accessRes.json();
    expect(decision.allowed).toBe(true);
  });

  it("consumes quota and denies when exhausted", async () => {
    await durable.fetch(
      new Request("https://entitlements/sync", {
        method: "POST",
        body: JSON.stringify({
          userId: "user",
          merchantId: "merchant",
          quotas: { runs: { remaining: 1 } },
        }),
      })
    );

    const consumeRes = await durable.fetch(
      new Request("https://entitlements/access", {
        method: "POST",
        body: JSON.stringify({ userId: "user", merchantId: "merchant", quotaKey: "runs", consume: true }),
      })
    );
    const consumeDecision = await consumeRes.json();
    expect(consumeDecision.allowed).toBe(true);
    expect(consumeDecision.quotaRemaining).toBe(0);

    const secondRes = await durable.fetch(
      new Request("https://entitlements/access", {
        method: "POST",
        body: JSON.stringify({ userId: "user", merchantId: "merchant", quotaKey: "runs", consume: true }),
      })
    );
    const secondDecision = await secondRes.json();
    expect(secondDecision.allowed).toBe(false);
    expect(secondDecision.reason).toBe("quota_exhausted");
  });
});
