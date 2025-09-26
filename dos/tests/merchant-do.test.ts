import { describe, expect, it, beforeEach } from "vitest";

import { MerchantDurableObject } from "../src/merchant-do";

const createDO = () => {
  const state: Record<string, any> = {};
  const storage = {
    get: async (key: string) => state[key] ?? null,
    put: async (key: string, value: unknown) => {
      state[key] = value;
    },
  } as any;
  const durable = new MerchantDurableObject({ storage } as any);
  return { durable, state };
};

describe("MerchantDurableObject", () => {
  let durable: MerchantDurableObject;
  let state: Record<string, any>;

  beforeEach(() => {
    const created = createDO();
    durable = created.durable;
    state = created.state;
  });

  const sampleConfig = {
    merchantId: "m1",
    origin: {
      baseUrl: "https://origin.example",
      auth: { kind: "api_key", secretRef: "env:API_KEY" },
    },
    pricing: {
      policyVersion: 1,
      policyDigest: "digest",
      rules: [
        { match: { method: "GET", path: "/chat" }, price: { flat: 2 } },
        { match: { method: "POST", path: "/upload/{id}" }, price: { perMbReq: 1, min: 5 } },
      ],
    },
  };

  it("returns 404 when config missing", async () => {
    const res = await durable.fetch(new Request("https://merchant/config", { method: "GET" }));
    expect(res.status).toBe(404);
  });

  it("stores configuration", async () => {
    const res = await durable.fetch(
      new Request("https://merchant/config", {
        method: "POST",
        body: JSON.stringify(sampleConfig),
      })
    );
    expect(res.status).toBe(200);
    expect(state.config.merchantId).toBe("m1");
  });

  it("computes flat pricing", async () => {
    await durable.fetch(
      new Request("https://merchant/config", {
        method: "POST",
        body: JSON.stringify(sampleConfig),
      })
    );
    const res = await durable.fetch(
      new Request("https://merchant/price", {
        method: "POST",
        body: JSON.stringify({ method: "GET", path: "/chat" }),
      })
    );
    const body = await res.json();
    expect(body.estimated_price).toBe(2);
    expect(body.currency).toBe("USD");
  });

  it("computes minimum pricing for per-mb", async () => {
    await durable.fetch(
      new Request("https://merchant/config", {
        method: "POST",
        body: JSON.stringify(sampleConfig),
      })
    );
    const res = await durable.fetch(
      new Request("https://merchant/estimate", {
        method: "POST",
        body: JSON.stringify({ method: "POST", path: "/upload/123", requestBytes: 1024 }),
      })
    );
    const body = await res.json();
    expect(body.estimated_price).toBeGreaterThanOrEqual(5);
  });
});
