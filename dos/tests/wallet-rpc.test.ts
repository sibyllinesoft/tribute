import { describe, expect, it, vi } from "vitest";

import { WalletRpcClient } from "../src/wallet-rpc";

const createNamespace = () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  return {
    namespace: {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({ fetch } as any)),
    } as any,
    fetch,
  };
};

describe("WalletRpcClient", () => {
  it("checkBudget hits durable object", async () => {
    const { namespace, fetch } = createNamespace();
    const client = new WalletRpcClient(namespace);
    const result = await client.checkBudget({
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
      tokenFingerprint: "fp",
      pricingMode: "estimate-first",
      priceSig: "sig",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://wallet/check-budget",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.ok).toBe(true);
  });

  it("delegates debit and refund", async () => {
    const { namespace, fetch } = createNamespace();
    const client = new WalletRpcClient(namespace);
    await client.debit({
      nonce: "n",
      userId: "u",
      merchantId: "m",
      finalPrice: 5,
      currency: "USD",
      tokenFingerprint: "fp",
    });
    expect(fetch).toHaveBeenCalledWith("https://wallet/debit", expect.any(Object));

    fetch.mockResolvedValueOnce(new Response("ok"));
    await client.refund("receipt");
    expect(fetch).toHaveBeenCalledWith("https://wallet/refund", expect.any(Object));
  });
});
