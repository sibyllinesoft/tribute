import { afterEach, describe, expect, it, vi } from "vitest";

import { handleMeteredRequest } from "../src/index";

interface RedeemHandlers {
  [path: string]: (init: RequestInit) => Promise<Response> | Response;
}

const makeRedeemNamespace = (handlers: RedeemHandlers) => {
  const stub = {
    fetch: async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const handler = handlers[path];
      if (!handler) return new Response("not_found", { status: 404 });
      return handler(init);
    },
  };
  return {
    idFromName: vi.fn(() => ({} as any)),
    get: vi.fn(() => stub),
  } as any;
};

const baseClaims = {
  nonce: "nonce",
  sub: "user",
  mer: "merchant",
  rid: "GET:/chat",
  method: "POST",
  inputs_hash: "hash",
  max_price: 100,
  ccy: "USD",
  policy_ver: 1,
  policy_digest: "digest",
  origin_host: "origin",
  price_sig: "sig",
} as any;

const merchantConfig = {
  origin: {
    baseUrl: "https://origin.example",
    auth: { kind: "api_key", secretRef: "env:API_KEY", header: "x-api-key" },
  },
  pricing: {
    policyVersion: 1,
    policyDigest: "digest",
    variablePricing: true,
    estimatePathSuffix: "/estimate",
  },
} as any;

const baseEnv = (overrides: Partial<any> = {}) => ({
  REDEEM_DO: makeRedeemNamespace({}),
  MERCHANT_DO: {} as any,
  USER_WALLET_DO: {} as any,
  HISTORY_DO: {} as any,
  RECEIPTS_KV: {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  },
  ARTIFACTS_R2: {
    get: vi.fn(async () => ({
      arrayBuffer: async () => new TextEncoder().encode("cached").buffer,
      httpMetadata: { contentType: "text/plain" },
    })),
    put: vi.fn(async () => undefined),
  },
  JWK_KV: {} as any,
  API_KEY: "secret",
  ...overrides,
});

describe("handleMeteredRequest integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns replayed receipt", async () => {
    const receipt = {
      receiptId: "r1",
      nonce: baseClaims.nonce,
      userId: baseClaims.sub,
      merchantId: baseClaims.mer,
      rid: baseClaims.rid,
      inputsHash: baseClaims.inputs_hash,
      policyVersion: 1,
      policyDigest: "digest",
      maxPrice: 0,
      finalPrice: 0,
      currency: baseClaims.ccy,
      timestamp: new Date().toISOString(),
      status: "paid",
      contentHash: "hash",
      originStatus: 200,
      originHeadersSubset: {},
      tokenFingerprint: "fp",
      proxySignature: "sig",
      pricingMode: "estimate-first",
    };

    const handlers: RedeemHandlers = {
      "/begin": async () => new Response(JSON.stringify({ status: "replay", receipt }), { status: 200 }),
    };

    const env = baseEnv({ REDEEM_DO: makeRedeemNamespace(handlers) });
    const res = await handleMeteredRequest({
      request: new Request("https://proxy/chat"),
      env: env as any,
      claims: baseClaims,
      merchantConfig,
      tokenFingerprint: "fp",
      proxyContext: "ctx",
      receiptKey: "key",
      requestedPricingMode: "estimate-first",
      maxPrice: 10,
      bodyBytes: null,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Receipt-Id")).toBe("r1");
    expect(env.ARTIFACTS_R2.get).toHaveBeenCalledWith("hash");
  });

  it("cancels redeem when estimate fetch fails", async () => {
    const cancelSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const handlers: RedeemHandlers = {
      "/begin": async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
      "/cancel": cancelSpy,
    };

    const env = baseEnv({ REDEEM_DO: makeRedeemNamespace(handlers) });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/estimate")) {
          return new Response("fail", { status: 500 });
        }
        return new Response("ok", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const res = await handleMeteredRequest({
      request: new Request("https://proxy/chat", { method: "POST", body: "{}" }),
      env: env as any,
      claims: baseClaims,
      merchantConfig,
      tokenFingerprint: "fp",
      proxyContext: "ctx",
      receiptKey: "key",
      requestedPricingMode: "estimate-first",
      maxPrice: 5,
      bodyBytes: new TextEncoder().encode("{}"),
    });

    expect(res.status).toBe(502);
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("stores cached estimate and persists receipt on commit", async () => {
    const handlers: RedeemHandlers = {
      "/begin": async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
      "/commit": async () =>
        new Response(
          JSON.stringify({
            status: "ok",
            receipt: {
              receiptId: "r2",
              nonce: baseClaims.nonce,
              userId: baseClaims.sub,
              merchantId: baseClaims.mer,
              rid: baseClaims.rid,
              inputsHash: baseClaims.inputs_hash,
              policyVersion: 1,
              policyDigest: "digest",
              maxPrice: 10,
              finalPrice: 4,
              currency: baseClaims.ccy,
              timestamp: new Date().toISOString(),
              status: "paid",
              contentHash: "hash",
              originStatus: 200,
              originHeadersSubset: {},
              tokenFingerprint: "fp",
              proxySignature: "sig",
              pricingMode: "estimate-first",
            },
          }),
          { status: 200 }
        ),
      "/cancel": async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    };

    const receiptsKV = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    const artifactsR2 = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };

    const env = baseEnv({ REDEEM_DO: makeRedeemNamespace(handlers), RECEIPTS_KV: receiptsKV, ARTIFACTS_R2: artifactsR2 });

    const estimateResponse = new Response(
      JSON.stringify({
        estimated_price: 3,
        currency: "USD",
        policy_ver: 1,
        policy_digest: "digest",
        price_sig: "sig",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
    const originResponse = new Response(JSON.stringify({ final_price: 4 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(estimateResponse)
        .mockResolvedValueOnce(originResponse)
    );

    const res = await handleMeteredRequest({
      request: new Request("https://proxy/chat", { method: "POST", body: "{}" }),
      env: env as any,
      claims: baseClaims,
      merchantConfig,
      tokenFingerprint: "fp",
      proxyContext: "ctx",
      receiptKey: "key",
      requestedPricingMode: "estimate-first",
      maxPrice: 10,
      bodyBytes: new TextEncoder().encode("{}"),
    });

    expect(res.status).toBe(200);
    expect(receiptsKV.put).toHaveBeenCalled();
    expect(artifactsR2.put).toHaveBeenCalled();
  });
});
