import { describe, it, expect, beforeEach, vi } from "vitest";
import edgeProxy from "@tribute/edge-proxy";
import { SignJWT } from "jose";

const signingKey = "super-secret";
const policyDigest = "digest-1";

const base64UrlEncode = (input: string): string => {
  const data = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const jwks = {
  keys: [
    {
      kty: "oct",
      k: base64UrlEncode(signingKey),
      alg: "HS256",
      kid: "primary",
    },
  ],
};

describe("edge proxy happy path", () => {
  let originFetch: ReturnType<typeof vi.fn>;
  let env: any;
  let redeemState: { beginCalls: number; commitCalls: number; receipt?: any; lastBegin?: any; lastCommit?: any };

  beforeEach(() => {
    originFetch = vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/estimate")) {
        return new Response(
          JSON.stringify({
            estimated_price: 0.5,
            currency: "USD",
            policy_ver: 1,
            policy_digest: policyDigest,
            estimate_is_final: false,
            price_sig: "sig-estimate",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return new Response(
        JSON.stringify({
          final_price: 0.42,
          currency: "USD",
          usage: { prompt_tokens: 10, completion_tokens: 20 },
          price_sig: "sig-final",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    });
    globalThis.fetch = originFetch as any;

    redeemState = { beginCalls: 0, commitCalls: 0 };

    env = {
      REDEEM_DO: createRedeemNamespace(redeemState),
      MERCHANT_DO: createMerchantNamespace(),
      USER_WALLET_DO: {} as any,
      HISTORY_DO: {} as any,
      RECEIPTS_KV: createKv(),
      ARTIFACTS_R2: createR2(),
      JWK_KV: { get: vi.fn(async () => jwks) },
      ORIGIN_TOKEN: "origin-secret",
    };
  });

  it("only hits origin once for identical request", async () => {
    const token = await issueToken({
      sub: "user-1",
      mer: "merchant-1",
      rid: "/v1/demo",
      method: "GET",
      inputsHash: "hash-1",
      maxPrice: 1,
      currency: "USD",
      policyVersion: 1,
    });

    const request = new Request("https://proxy.example.com/v1/demo", {
      headers: { authorization: `Bearer ${token}` },
    });

    const responseA = await edgeProxy.fetch(request, env, createCtx());
    expect(responseA.status).toBe(200);
    expect(originFetch).toHaveBeenCalledTimes(2);
    const bodyA = await responseA.json();
    expect(bodyA.final_price).toBeCloseTo(0.42);

    const requestB = new Request("https://proxy.example.com/v1/demo", {
      headers: { authorization: `Bearer ${token}` },
    });
    const responseB = await edgeProxy.fetch(requestB, env, createCtx());
    expect(responseB.status).toBe(200);
    expect(originFetch).toHaveBeenCalledTimes(2);
    const bodyB = await responseB.json();
    expect(bodyB.final_price).toBeCloseTo(0.42);
    expect(redeemState.beginCalls).toBeGreaterThanOrEqual(1);
    expect(redeemState.commitCalls).toBeGreaterThanOrEqual(1);
  });

  it("skips billing when subscription entitlement grants access", async () => {
    originFetch.mockImplementation(async () =>
      new Response("entitled", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );

    const entState = createEntitlementsNamespace({ allow: true, fallback: "block" });
    env.ENTITLEMENTS_DO = entState.namespace;
    env.MERCHANT_DO = createMerchantNamespace({
      variablePricing: false,
      entitlements: {
        "/v1/subscribed": { feature: "plan_pro", fallbackMode: "block" },
      },
    });

    const token = await issueToken({
      sub: "user-2",
      mer: "merchant-1",
      rid: "/v1/subscribed",
      method: "GET",
      inputsHash: "hash-sub",
      maxPrice: 1,
      currency: "USD",
      policyVersion: 1,
    });

    const request = new Request("https://proxy.example.com/v1/subscribed", {
      headers: { authorization: `Bearer ${token}` },
    });

    const response = await edgeProxy.fetch(request, env, createCtx());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("entitled");
    expect(redeemState.beginCalls).toBe(0);
    expect(redeemState.commitCalls).toBe(0);
    expect(entState.accessCalls.filter((call) => call.consume === false)).toHaveLength(1);
    expect(entState.accessCalls.filter((call) => call.consume === true)).toHaveLength(1);

    const receiptKey = `/v1/subscribed::hash-sub::1`;
    const stored = await env.RECEIPTS_KV.get(receiptKey, "json");
    expect(stored.finalPrice).toBe(0);
    expect(stored.pricingMode).toBe("subscription");
  });
});

const createCtx = () => ({ waitUntil: (_promise: Promise<unknown>) => {} }) as ExecutionContext;

const issueToken = async (opts: {
  sub: string;
  mer: string;
  rid: string;
  method: string;
  inputsHash: string;
  maxPrice: number;
  currency: string;
  policyVersion: number;
}) => {
  const now = Math.floor(Date.now() / 1000);
  const priceSig = await sha256Base64Url(`${opts.maxPrice}|${policyDigest}|${opts.inputsHash}`);
  return new SignJWT({
    nonce: crypto.randomUUID(),
    sub: opts.sub,
    mer: opts.mer,
    rid: opts.rid,
    method: opts.method,
    inputs_hash: opts.inputsHash,
    max_price: opts.maxPrice,
    ccy: opts.currency,
    policy_ver: opts.policyVersion,
    policy_digest: policyDigest,
    aud: "proxy",
    iss: "tribute",
    iat: now,
    exp: now + 300,
    origin_host: "origin.example.com",
    price_sig: priceSig,
  })
    .setProtectedHeader({ alg: "HS256", kid: "primary" })
    .sign(new TextEncoder().encode(signingKey));
};

const createRedeemNamespace = (state: { beginCalls: number; commitCalls: number; receipt?: any; lastBegin?: any; lastCommit?: any }): DurableObjectNamespace => ({
  idFromName(name: string) {
    return name;
  },
  get() {
    return {
      fetch: async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        if (path === "/begin") {
          state.beginCalls += 1;
          state.lastBegin = init?.body ? JSON.parse(init!.body as string) : undefined;
          if (state.receipt) {
            return jsonResponse({ status: "replay", receipt: state.receipt });
          }
          return jsonResponse({ status: "ok" });
        }
        if (path === "/commit") {
          state.commitCalls += 1;
          const payload = JSON.parse(init?.body as string);
          state.lastCommit = payload;
          const receipt = {
            receiptId: "r-1",
            nonce: payload.nonce,
            userId: payload.userId,
            merchantId: payload.merchantId,
            rid: payload.rid,
            inputsHash: payload.inputsHash,
            policyVersion: payload.policyVersion,
            policyDigest,
            maxPrice: state.lastBegin?.maxPrice ?? payload.finalPrice,
            estimatedPrice: payload.estimatedPrice,
            finalPrice: payload.finalPrice,
            currency: payload.currency,
            timestamp: new Date().toISOString(),
            status: "paid",
            contentHash: payload.contentHash,
            originStatus: payload.originStatus,
            originHeadersSubset: payload.originHeaders,
            tokenFingerprint: payload.tokenFingerprint,
            proxySignature: payload.proxySignature,
            pricingMode: payload.pricingMode,
            estDigest: payload.estDigest,
            observablesDigest: payload.observablesDigest,
            finalPriceSig: payload.finalPriceSig,
            pricingUnattested: payload.pricingUnattested,
          };
          state.receipt = receipt;
          return jsonResponse({ status: "ok", receipt });
        }
        if (path === "/cancel") {
          return jsonResponse({ status: "ok" });
        }
        return jsonResponse({ error: "not_found" }, 404);
      },
    } as DurableObjectStub;
  },
}) as DurableObjectNamespace;

const createMerchantNamespace = (opts?: {
  variablePricing?: boolean;
  entitlements?: Record<string, { feature: string; fallbackMode?: "metered" | "block" }>;
}): DurableObjectNamespace => ({
  idFromName() {
    return "merchant";
  },
  get() {
    return {
      fetch: async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/config") {
          return jsonResponse({
            merchantId: "merchant-1",
            origin: {
              baseUrl: "https://origin.example.com",
              auth: { kind: "api_key", secretRef: "env:ORIGIN_TOKEN", header: "x-api-key" },
            },
            pricing: {
              policyVersion: 1,
              policyDigest,
              variablePricing: opts?.variablePricing ?? true,
              estimatePathSuffix: "/estimate",
              estimateIsFinal: false,
              priceUnit: "USD",
              rules: [],
            },
            ...(opts?.entitlements
              ? {
                  entitlements: {
                    routes: opts.entitlements,
                  },
                }
              : {}),
          });
        }
        if (path === "/estimate") {
          return jsonResponse({
            estimated_price: 0.5,
            currency: "USD",
            policy_ver: 1,
            policy_digest: policyDigest,
            estimate_is_final: false,
          });
        }
        return jsonResponse({ error: "not_found" }, 404);
      },
    } as DurableObjectStub;
  },
}) as DurableObjectNamespace;

const createEntitlementsNamespace = (opts?: {
  allow?: boolean;
  fallback?: "metered" | "block";
  upgradeUrl?: string;
}) => {
  const accessCalls: Array<{ consume?: boolean }> = [];
  const namespace = {
    idFromName(name: string) {
      return name;
    },
    get() {
      return {
        fetch: async (url: string, init: RequestInit) => {
          const path = new URL(url).pathname;
          if (path === "/access") {
            const body = JSON.parse(init?.body as string);
            accessCalls.push({ consume: body.consume });
            const allowed = opts?.allow ?? false;
            return jsonResponse({
              allowed,
              fallbackToMetered: (opts?.fallback ?? "metered") !== "block",
              reason: allowed ? undefined : "subscription_required",
              upgradeUrl: opts?.upgradeUrl,
            });
          }
          return jsonResponse({ error: "not_found" }, 404);
        },
      } as DurableObjectStub;
    },
  } as DurableObjectNamespace;

  return { namespace, accessCalls };
};

const createKv = () => {
  const map = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = map.get(key);
      if (!value) return null;
      return type === "json" ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
  };
};

const createR2 = () => {
  const map = new Map<string, { body: ArrayBuffer; httpMetadata?: { contentType?: string; cacheControl?: string } }>();
  return {
    put: vi.fn(async (key: string, body: ArrayBuffer, options: any) => {
      map.set(key, { body, httpMetadata: options?.httpMetadata });
    }),
    get: vi.fn(async (key: string) => {
      const value = map.get(key);
      if (!value) return null;
      return {
        body: value.body,
        httpMetadata: value.httpMetadata,
        arrayBuffer: async () => value.body,
      };
    }),
  };
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sha256Base64Url = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
