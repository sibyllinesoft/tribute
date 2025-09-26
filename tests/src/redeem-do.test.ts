import { describe, it, expect } from "vitest";
import { RedeemDurableObject } from "@tribute/durable-objects";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("RedeemDurableObject", () => {
  it("enforces single redemption per nonce", async () => {
    const storage = createStorage();
    const env = createEnv();
    const redeem = new RedeemDurableObject({ storage } as any, env as any);

    const beginPayload = {
      nonce: "nonce-1",
      userId: "user-1",
      merchantId: "merchant-1",
      rid: "GET /v1/demo",
      method: "GET",
      inputsHash: "hash-abc",
      maxPrice: 1,
      currency: "USD",
      policyVersion: 1,
      policyDigest: "digest-1",
      tokenFingerprint: "fingerprint-1",
      pricingMode: "estimate-first" as const,
      priceSig: "sig-1",
    };

    const beginRes = await redeem.fetch(new Request("https://redeem/begin", {
      method: "POST",
      body: JSON.stringify(beginPayload),
    }));
    expect(beginRes.status).toBe(200);
    const beginBody = await beginRes.json();
    expect(beginBody).toEqual({ status: "ok" });

    const commitPayload = {
      nonce: "nonce-1",
      rid: "GET /v1/demo",
      inputsHash: "hash-abc",
      policyVersion: 1,
      policyDigest: "digest-1",
      finalPrice: 0.9,
      estimatedPrice: 0.8,
      currency: "USD",
      userId: "user-1",
      merchantId: "merchant-1",
      contentHash: "content-xyz",
      originStatus: 200,
      originHeaders: { "content-type": "application/json" },
      tokenFingerprint: "fingerprint-1",
      proxySignature: "sig-demo",
      pricingMode: "estimate-first" as const,
      estDigest: "est-digest",
      observablesDigest: "obs-digest",
      finalPriceSig: "final-sig",
      pricingUnattested: false,
    };

    const commitRes = await redeem.fetch(new Request("https://redeem/commit", {
      method: "POST",
      body: JSON.stringify(commitPayload),
    }));
    expect(commitRes.status).toBe(200);
    const commitBody = await commitRes.json();
    expect(commitBody.status).toBe("ok");
    expect(commitBody.receipt.receiptId).toBeDefined();

    const replayRes = await redeem.fetch(new Request("https://redeem/commit", {
      method: "POST",
      body: JSON.stringify(commitPayload),
    }));
    const replayBody = await replayRes.json();
    expect(replayBody.status).toBe("replay");
    expect(replayBody.receipt.receiptId).toBe(commitBody.receipt.receiptId);
  });
});

const createEnv = () => {
  const walletResponses: Record<string, Response> = {
    "/check-budget": jsonResponse({ ok: true }),
    "/debit": jsonResponse({ ok: true, balanceAfter: 9 }),
    "/refund": jsonResponse({ ok: true }),
  };

  const walletNamespace = {
    idFromName(name: string) {
      return name;
    },
    get() {
      return {
        fetch(url: string) {
          const path = new URL(url).pathname as keyof typeof walletResponses;
          return walletResponses[path] ?? jsonResponse({ error: "not_found" }, 404);
        },
      };
    },
  };

  return {
    USER_WALLET_DO: walletNamespace,
    MERCHANT_DO: {} as any,
    HISTORY_DO: {} as any,
    RECEIPTS_KV: {} as any,
    NONCES_KV: {} as any,
  };
};

const createStorage = (): DurableObjectStorage => {
  const map = new Map<string, unknown>();
  return {
    get: async (key: string) => map.get(key),
    put: async (key: string, value: unknown) => {
      map.set(key, value);
    },
    delete: async (key: string) => {
      map.delete(key);
    },
    list: async () => map,
  } as unknown as DurableObjectStorage;
};
