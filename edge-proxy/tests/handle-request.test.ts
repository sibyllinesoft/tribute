import { afterEach, describe, expect, it, vi } from "vitest";

type LoadOptions = {
  claims?: Partial<any>;
  merchantConfig?: any;
  cachedReceipt?: any;
  entitlementDecision?: any;
  entitlementConsumeDecision?: any;
  cachedEstimate?: any;
  token?: string;
  beginResponse?: any;
  commitResponse?: any;
};

const defaultClaims = {
  sub: "user-1",
  mer: "merchant-1",
  rid: "GET:/entitled",
  method: "POST",
  inputs_hash: "inputs-hash",
  policy_ver: 1,
  policy_digest: "digest",
  max_price: 10,
  nonce: "nonce-1",
  ccy: "USD",
  origin_host: "origin.example",
  price_sig: "token-sig",
};

const defaultMerchantConfig = {
  origin: {
    baseUrl: "https://origin.example",
    auth: { kind: "api_key", secretRef: "env:API_KEY", header: "x-api-key" },
  },
  pricing: {
    policyVersion: 1,
    policyDigest: "digest",
    variablePricing: false,
    estimateIsFinal: false,
  },
  entitlements: {
    routes: {
      "GET:/entitled": { feature: "gold", quotaKey: "quota-1" },
    },
  },
};

const loadProxyWithMocks = async (options: LoadOptions = {}) => {
  vi.resetModules();

  const claims = { ...defaultClaims, ...options.claims };
  const merchantConfig = options.merchantConfig ?? defaultMerchantConfig;

  const receiptCacheKey = vi.fn(() => "receipt-key");
  const extractBearer = vi.fn(() => options.token ?? "token");
  const verifyPaymentToken = vi.fn(async () => claims);
  const sha256Base64Url = vi.fn(async (input: unknown) => {
    if (typeof input === "string" && input === "token") {
      return "token-fingerprint";
    }
    if (typeof input === "string" && input.includes("|")) {
      return "proxy-signature";
    }
    if (typeof input === "string") {
      return `hash:${input.slice(0, 8)}`;
    }
    return "content-hash";
  });
  const getCachedReceipt = vi.fn(async () => options.cachedReceipt ?? null);
  const putReceiptAndArtifact = vi.fn(async () => undefined);
  const getCachedEstimate = vi.fn(async () => options.cachedEstimate ?? null);
  const putCachedEstimate = vi.fn(async () => undefined);
  const buildProxyContextHeader = vi.fn(async () => "proxy-context");
  const buildOriginRequest = vi.fn(async (_req: Request, _config: any, _env: any, opts: { overridePath?: string } = {}) => ({
    url: new URL(`https://origin.example${opts.overridePath ?? "/resource"}`),
    headers: new Headers({ "x-proxied": "1" }),
  }));
  const entitlementAccess = vi.fn(async (params: any) => {
    if (params.consume) {
      return options.entitlementConsumeDecision ?? { allowed: true };
    }
    return options.entitlementDecision ?? { allowed: true, fallbackToMetered: false };
  });

  class MerchantClient {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_ns: any) {}
    async getConfig(): Promise<any> {
      return merchantConfig;
    }
  }

  class EntitlementsClient {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_ns: any) {}
    access = entitlementAccess;
  }

  class RedeemClient {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_ns: any) {}
    begin = vi.fn(async () => options.beginResponse ?? { status: "ok" });
    commit = vi.fn(async () =>
      options.commitResponse ??
      new Response(
        JSON.stringify({
          status: "ok",
          receipt: {
            receiptId: "redeem-receipt",
            nonce: claims.nonce,
            userId: claims.sub,
            merchantId: claims.mer,
            rid: claims.rid,
            inputsHash: claims.inputs_hash,
            policyVersion: claims.policy_ver,
            policyDigest: claims.policy_digest,
            maxPrice: claims.max_price,
            finalPrice: 4,
            currency: claims.ccy,
            timestamp: new Date().toISOString(),
            status: "paid",
            contentHash: "content-hash",
            originStatus: 200,
            originHeadersSubset: {},
            tokenFingerprint: "token-fingerprint",
            proxySignature: "proxy-signature",
            pricingMode: "estimate-first",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    cancel = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
  }

  vi.doMock("@tribute/durable-objects", () => ({
    receiptCacheKey,
  }));
  vi.doMock("../src/token", () => ({
    extractBearer,
    verifyPaymentToken,
  }));
  vi.doMock("../src/crypto", () => ({
    sha256Base64Url,
  }));
  vi.doMock("../src/context", () => ({
    buildProxyContextHeader,
  }));
  vi.doMock("../src/cache", () => ({
    getCachedReceipt,
    putReceiptAndArtifact,
    getCachedEstimate,
    putCachedEstimate,
  }));
  vi.doMock("../src/merchant-client", () => ({
    MerchantClient,
  }));
  vi.doMock("../src/entitlements-client", () => ({
    EntitlementsClient,
  }));
  vi.doMock("../src/redeem-client", () => ({
    RedeemClient,
  }));
  vi.doMock("../src/origin", () => ({
    buildOriginRequest,
  }));

  const module = await import("../src/index");

  return {
    module,
    proxy: module.default,
    claims,
    merchantConfig,
    spies: {
      receiptCacheKey,
      extractBearer,
      verifyPaymentToken,
      sha256Base64Url,
      getCachedReceipt,
      putReceiptAndArtifact,
      getCachedEstimate,
      putCachedEstimate,
      buildProxyContextHeader,
      buildOriginRequest,
      entitlementAccess,
    },
  } as const;
};

const createEnv = () => ({
  MERCHANT_DO: {} as any,
  ENTITLEMENTS_DO: {} as any,
  ARTIFACTS_R2: {} as any,
});

describe("handleRequest", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns cached receipt when available", async () => {
    const cachedBody = new TextEncoder().encode("cached-body").buffer;
    const { proxy, spies } = await loadProxyWithMocks({
      cachedReceipt: {
        receipt: {
          receiptId: "cached-receipt",
          userId: defaultClaims.sub,
          contentHash: "cached-hash",
        },
        content: cachedBody,
        contentType: "text/plain",
      },
    });

    vi.stubGlobal("fetch", vi.fn());

    const res = await proxy.fetch(
      new Request("https://proxy.example/resource", {
        headers: { authorization: "Bearer cached" },
      }),
      createEnv(),
      { waitUntil: vi.fn() } as any
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Receipt-Id")).toBe("cached-receipt");
    expect(await res.text()).toBe("cached-body");
    expect(spies.getCachedReceipt).toHaveBeenCalled();
    expect(spies.putReceiptAndArtifact).not.toHaveBeenCalled();
  });

  it("handles entitled requests and caches artifacts", async () => {
    const { proxy, spies } = await loadProxyWithMocks();
    const waitUntil = vi.fn(() => {
      throw new Error("no-wait");
    });
    const originResponse = new Response(
      JSON.stringify({ final_price: 4, usage: { tokens: 2 }, price_sig: "sig" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
    vi.stubGlobal("fetch", vi.fn(async () => originResponse.clone()));
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("receipt-123");

    const res = await proxy.fetch(
      new Request("https://proxy.example/resource", {
        method: "POST",
        headers: { authorization: "Bearer allow" },
        body: JSON.stringify({ hello: "world" }),
      }),
      createEnv(),
      { waitUntil } as any
    );

    expect(res.status).toBe(200);
    expect(spies.entitlementAccess).toHaveBeenCalledWith(expect.objectContaining({ consume: false }));
    expect(spies.entitlementAccess).toHaveBeenCalledWith(expect.objectContaining({ consume: true }));
    expect(waitUntil).toHaveBeenCalled();
    expect(spies.putReceiptAndArtifact).toHaveBeenCalledWith(
      expect.any(Object),
      "receipt-key",
      expect.objectContaining({ receiptId: "receipt-123" }),
      expect.any(ArrayBuffer),
      expect.objectContaining({ contentType: "application/json" })
    );
    expect(await res.json()).toEqual({ final_price: 4, usage: { tokens: 2 }, price_sig: "sig" });

    randomUUID.mockRestore();
  });

  it("returns subscription required when entitlement denied", async () => {
    const { proxy } = await loadProxyWithMocks({
      entitlementDecision: {
        allowed: false,
        fallbackToMetered: false,
        reason: "upgrade",
        upgradeUrl: "https://upgrade",
      },
    });

    vi.stubGlobal("fetch", vi.fn());

    const res = await proxy.fetch(
      new Request("https://proxy.example/resource", {
        headers: { authorization: "Bearer deny" },
      }),
      createEnv(),
      { waitUntil: vi.fn() } as any
    );

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("subscription_required");
    expect(res.headers.get("X-Upgrade-Url")).toBe("https://upgrade");
  });

  it("validates max price header", async () => {
    const { proxy } = await loadProxyWithMocks();
    vi.stubGlobal("fetch", vi.fn());

    const res = await proxy.fetch(
      new Request("https://proxy.example/resource", {
        headers: {
          authorization: "Bearer over",
          "x-max-price": "999",
        },
      }),
      createEnv(),
      { waitUntil: vi.fn() } as any
    );

    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error).toBe("max_price_exceeds_token");
  });

  it("clones origin errors for entitled requests", async () => {
    const { proxy, spies } = await loadProxyWithMocks();
    const failingResponse = new Response("downstream", { status: 503 });
    vi.stubGlobal("fetch", vi.fn(async () => failingResponse.clone()));

    const res = await proxy.fetch(
      new Request("https://proxy.example/resource", {
        method: "POST",
        headers: { authorization: "Bearer allow" },
      }),
      createEnv(),
      { waitUntil: vi.fn() } as any
    );

    expect(res.status).toBe(503);
    expect(await res.text()).toBe("downstream");
    expect(spies.putReceiptAndArtifact).not.toHaveBeenCalled();
  });
});
