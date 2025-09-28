import { describe, it, beforeEach, expect, vi } from "vitest";
import edgeProxy from "@tribute/edge-proxy";

const policyDigest = "digest-1";

type DurableObjectNamespace = any;
type DurableObjectStub = any;

describe("edge proxy auto-preflight", () => {
  let redeemState: { beginCalls: number; commitCalls: number };
  let env: any;

  beforeEach(() => {
    redeemState = { beginCalls: 0, commitCalls: 0 };

    env = {
      REDEEM_DO: createRedeemNamespace(redeemState),
      MERCHANT_DO: createMerchantNamespace(),
      ENTITLEMENTS_DO: {} as any,
      ARTIFACTS_R2: createR2(),
      RECEIPTS_KV: createKv(),
      ORIGIN_TOKEN: "origin-secret",
    };

    globalThis.fetch = vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/estimate")) {
        return new Response(
          JSON.stringify({
            estimated_price: 0.4,
            currency: "USD",
            policy_ver: 1,
            policy_digest: policyDigest,
            estimate_is_final: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          final_price: 0.38,
          currency: "USD",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as any;
  });

  it("meters the request when within default cap", async () => {
    const request = new Request("https://app.example.com/v1/demo", {
      method: "GET",
      headers: { authorization: "Bearer session-1" },
    });

    const response = await edgeProxy.fetch(request, env, createCtx());

    expect(response.status).toBe(200);
    expect(redeemState.beginCalls).toBeGreaterThan(0);
    expect(redeemState.commitCalls).toBeGreaterThan(0);
  });

  it("returns 402 when estimate exceeds cap", async () => {
    globalThis.fetch = vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/estimate")) {
        return new Response(
          JSON.stringify({
            estimated_price: 5,
            currency: "USD",
            policy_ver: 1,
            policy_digest: policyDigest,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    const request = new Request("https://app.example.com/v1/demo", {
      method: "GET",
      headers: { authorization: "Bearer session-1" },
    });

    const response = await edgeProxy.fetch(request, env, createCtx());
    expect(response.status).toBe(402);
    const payload = await response.json();
    expect(payload.error).toBe("cap_exceeded");
  });

  it("passes through unauthenticated requests", async () => {
    const request = new Request("https://app.example.com/v1/demo", {
      method: "GET",
    });

    const response = await edgeProxy.fetch(request, env, createCtx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.final_price).toBe(0.38);
  });
});

const createCtx = () => ({ waitUntil: (_promise: Promise<unknown>) => {} }) as any;

const createRedeemNamespace = (state: { beginCalls: number; commitCalls: number }): DurableObjectNamespace => ({
  idFromName(name: string) {
    return name;
  },
  get() {
    return {
      fetch: async (url: string, init: RequestInit) => {
        const pathname = new URL(url).pathname;
        if (pathname === "/begin") {
          state.beginCalls += 1;
          return jsonResponse({ status: "ok" });
        }
        if (pathname === "/commit") {
          state.commitCalls += 1;
          return jsonResponse({
            status: "ok",
            receipt: {
              receiptId: "r-1",
              nonce: "nonce",
              userId: "user",
              merchantId: "merchant-1",
              rid: "/v1/demo",
              inputsHash: "hash",
              policyVersion: 1,
              policyDigest,
              maxPrice: 0.5,
              finalPrice: 0.38,
              currency: "USD",
              timestamp: new Date().toISOString(),
              status: "paid",
              contentHash: "hash",
              originStatus: 200,
              originHeadersSubset: {},
              tokenFingerprint: "fp",
              proxySignature: "sig",
              pricingMode: "estimate-first",
            },
          });
        }
        if (pathname === "/cancel") {
          return jsonResponse({ status: "ok" });
        }
        return jsonResponse({ error: "not_found" }, 404);
      },
    } as DurableObjectStub;
  },
}) as DurableObjectNamespace;

const createMerchantNamespace = (): DurableObjectNamespace => ({
  idFromName(name: string) {
    return name;
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
              variablePricing: true,
              estimatePathSuffix: "/estimate",
              estimateIsFinal: true,
              priceUnit: "USD",
              rules: [
                {
                  match: { method: "GET", path: "/v1/demo" },
                  price: { flat: 0.5 },
                },
              ],
            },
            preflight: {
              auto: true,
              defaultCap: 0.5,
              identity: { header: "authorization", required: true },
            },
          });
        }
        if (path === "/estimate") {
          return jsonResponse({
            estimated_price: 0.4,
            currency: "USD",
            policy_ver: 1,
            policy_digest: policyDigest,
            estimate_is_final: true,
          });
        }
        return jsonResponse({ error: "not_found" }, 404);
      },
    } as DurableObjectStub;
  },
}) as DurableObjectNamespace;

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
  return {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
  };
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
