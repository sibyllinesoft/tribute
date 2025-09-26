import { describe, expect, it, vi, afterAll } from "vitest";

import { createReceipt } from "../src/receipt";
import { receiptCacheKey } from "../src/types";

const nowIso = "2024-01-01T00:00:00.000Z";

vi.stubGlobal("crypto", {
  randomUUID: () => "uuid-1",
} as any);

vi.spyOn(Date.prototype, "toISOString").mockImplementation(function () {
  return nowIso;
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("receipt", () => {
  it("creates receipt with defaults", () => {
    const receipt = createReceipt({
      nonce: "nonce",
      userId: "user",
      merchantId: "merchant",
      rid: "GET:/chat",
      inputsHash: "hash",
      policyVersion: 1,
      policyDigest: "digest",
      maxPrice: 10,
      finalPrice: 5,
      currency: "USD",
      contentHash: "hash",
      originStatus: 200,
      originHeadersSubset: { "content-type": "json" },
      tokenFingerprint: "fp",
      proxySignature: "sig",
      pricingMode: "estimate-first",
    });

    expect(receipt.receiptId).toBe("uuid-1");
    expect(receipt.timestamp).toBe(nowIso);
    expect(receipt.status).toBe("paid");
  });

  it("computes receipt cache key", () => {
    expect(receiptCacheKey("GET:/chat", "hash", 3)).toBe("GET:/chat::hash::3");
  });
});
