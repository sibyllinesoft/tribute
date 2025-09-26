import { describe, expect, it, vi } from "vitest";

import { MerchantClient } from "../src/merchant-client";

const sampleConfig = {
  merchantId: "m1",
  origin: { baseUrl: "https://origin", auth: { kind: "api_key", secretRef: "env:KEY" } },
  pricing: { policyVersion: 1, policyDigest: "digest", rules: [], priceUnit: "USD" },
};

describe("MerchantClient", () => {
  it("fetches merchant config", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(sampleConfig), { status: 200 }));
    const namespace = {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({ fetch } as any)),
    } as any;

    const client = new MerchantClient(namespace);
    const config = await client.getConfig("merchant");
    expect(namespace.idFromName).toHaveBeenCalledWith("merchant");
    expect(config.merchantId).toBe("m1");
  });

  it("throws when config missing", async () => {
    const namespace = {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({ fetch: vi.fn(async () => new Response("not found", { status: 404 })) } as any)),
    } as any;

    const client = new MerchantClient(namespace);
    await expect(client.getConfig("merchant")).rejects.toThrow("merchant_config_missing:merchant");
  });
});
