import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  getCachedReceipt,
  putReceiptAndArtifact,
  getCachedEstimate,
  putCachedEstimate,
} from "../src/cache";
import type { ProxyEnv } from "../src/env";
import type { Receipt } from "@tribute/durable-objects";

const baseReceipt: Receipt = {
  receiptId: "r1",
  nonce: "n1",
  userId: "u1",
  merchantId: "m1",
  rid: "GET:/chat",
  inputsHash: "hash",
  policyVersion: 1,
  policyDigest: "digest",
  maxPrice: 100,
  finalPrice: 90,
  currency: "USD",
  timestamp: new Date().toISOString(),
  status: "paid",
  contentHash: "content-hash",
  originStatus: 200,
  originHeadersSubset: { "content-type": "application/json" },
  tokenFingerprint: "fingerprint",
  proxySignature: "sig",
  pricingMode: "estimate-first",
};

const createEnv = (): ProxyEnv => ({
  REDEEM_DO: {} as any,
  MERCHANT_DO: {} as any,
  USER_WALLET_DO: {} as any,
  HISTORY_DO: {} as any,
  RECEIPTS_KV: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  } as any,
  ARTIFACTS_R2: {
    get: vi.fn(),
    put: vi.fn(),
  } as any,
  JWK_KV: {} as any,
});

describe("cache", () => {
  let env: ProxyEnv;

  beforeEach(() => {
    env = createEnv();
  });

  it("returns null when receipt missing", async () => {
    (env.RECEIPTS_KV.get as any).mockResolvedValue(null);
    const result = await getCachedReceipt(env, "key");
    expect(result).toBeNull();
  });

  it("hydrates receipt content when artifact exists", async () => {
    (env.RECEIPTS_KV.get as any).mockResolvedValue(baseReceipt);
    (env.ARTIFACTS_R2.get as any).mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode("body").buffer),
      httpMetadata: { contentType: "text/plain" },
    });

    const result = await getCachedReceipt(env, "key");
    expect(result?.contentType).toBe("text/plain");
    expect(result?.content).not.toBeNull();
    expect(new TextDecoder().decode(result?.content ?? new ArrayBuffer(0))).toBe("body");
  });

  it("stores receipt and artifact", async () => {
    await putReceiptAndArtifact(env, "key", baseReceipt, new ArrayBuffer(0), {
      contentType: "application/json",
    });

    expect(env.RECEIPTS_KV.put).toHaveBeenCalledWith(
      "key",
      JSON.stringify(baseReceipt),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
    expect(env.ARTIFACTS_R2.put).toHaveBeenCalledWith(
      baseReceipt.contentHash,
      expect.any(ArrayBuffer),
      expect.objectContaining({ httpMetadata: expect.objectContaining({ contentType: "application/json" }) })
    );
  });

  it("evicts expired cached estimates", async () => {
    const entry = { estimatedPrice: 1, currency: "USD", policyVersion: 1, policyDigest: "d", estDigest: "e", expiresAt: Date.now() - 1000 };
    (env.RECEIPTS_KV.get as any).mockResolvedValue(entry);
    const result = await getCachedEstimate(env, "abc");
    expect(result).toBeNull();
    expect(env.RECEIPTS_KV.delete).toHaveBeenCalledWith("estimate::abc");
  });

  it("stores cached estimate with ttl", async () => {
    await putCachedEstimate(
      env,
      "abc",
      { estimatedPrice: 1, currency: "USD", policyVersion: 1, policyDigest: "digest", priceSig: null, estDigest: "dig" },
      60
    );
    expect(env.RECEIPTS_KV.put).toHaveBeenCalledWith(
      "estimate::abc",
      expect.any(String),
      expect.objectContaining({ expirationTtl: 60 })
    );
  });
});
