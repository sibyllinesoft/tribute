import { describe, expect, it, vi } from "vitest";

import { RedeemClient } from "../src/redeem-client";

const payload = {
  nonce: "n",
  userId: "u",
  merchantId: "m",
  rid: "GET:/chat",
  method: "POST",
  inputsHash: "hash",
  maxPrice: 10,
  currency: "USD",
  policyVersion: 1,
  policyDigest: "digest",
  tokenFingerprint: "fingerprint",
  pricingMode: "estimate-first" as const,
  priceSig: "sig",
};

describe("RedeemClient", () => {
  it("calls begin endpoint", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    const namespace = {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({ fetch } as any)),
    } as any;

    const client = new RedeemClient(namespace);
    const res = await client.begin("shard", payload);
    expect(namespace.idFromName).toHaveBeenCalledWith("shard");
    expect(fetch).toHaveBeenCalledWith(
      "https://redeem/begin",
      expect.objectContaining({ method: "POST" })
    );
    expect(res.status).toBe("ok");
  });

  it("calls commit endpoint", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const namespace = {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({ fetch } as any)),
    } as any;
    const client = new RedeemClient(namespace);
    await client.commit("shard", {
      nonce: "n",
      rid: "GET:/chat",
      inputsHash: "hash",
      policyVersion: 1,
      policyDigest: "digest",
      finalPrice: 5,
      currency: "USD",
      userId: "u",
      merchantId: "m",
      contentHash: "hash",
      originStatus: 200,
      tokenFingerprint: "fp",
      proxySignature: "sig",
      pricingMode: "estimate-first",
    });
    expect(fetch).toHaveBeenCalledWith("https://redeem/commit", expect.any(Object));
  });

  it("calls cancel endpoint", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const namespace = {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({ fetch } as any)),
    } as any;
    const client = new RedeemClient(namespace);
    await client.cancel("shard", { nonce: "n", reason: "timeout" });
    expect(fetch).toHaveBeenCalledWith("https://redeem/cancel", expect.any(Object));
  });
});
