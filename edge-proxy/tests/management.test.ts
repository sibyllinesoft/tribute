import { describe, expect, it, vi } from "vitest";

import { maybeHandleManagementRequest } from "../src/management";
import type { ProxyEnv } from "../src/env";

const baseReceipt = {
  receiptId: "r-1",
  nonce: "nonce",
  userId: "user-1",
  merchantId: "merchant-1",
  rid: "GET:/hello",
  inputsHash: "hash",
  policyVersion: 1,
  policyDigest: "digest",
  maxPrice: 10,
  finalPrice: 4,
  currency: "USD",
  timestamp: new Date().toISOString(),
  status: "paid",
  contentHash: null,
  originStatus: 200,
  originHeadersSubset: {},
  tokenFingerprint: "fp",
  proxySignature: "sig",
  pricingMode: "estimate-first",
};

describe("management endpoints", () => {
  const createEnv = (): ProxyEnv => ({
    REDEEM_DO: {} as any,
    MERCHANT_DO: {} as any,
    MERCHANT_APP_DO: {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({
        fetch: vi.fn(async (_url: string, init: RequestInit = {}) =>
          init.method === "GET"
            ? new Response(JSON.stringify({ error: "config_missing" }), { status: 404, headers: { "content-type": "application/json" } })
            : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
        ),
      })),
    } as any,
    USER_WALLET_DO: {
      idFromName: vi.fn(() => ({} as any)),
      get: vi.fn(() => ({
        fetch: vi.fn(async () =>
          new Response(
            JSON.stringify({ balance: 42, currency: "USD", budgets: { reserved: 1 } }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        ),
      })),
    } as any,
    HISTORY_DO: {} as any,
    ENTITLEMENTS_DO: {} as any,
    RECEIPTS_KV: {
      list: vi.fn(async () => ({ keys: [{ name: "receipt-id::r-1" }] })),
      get: vi.fn(async (key: string) => (key === "receipt-id::r-1" ? baseReceipt : null)),
      put: vi.fn(),
      delete: vi.fn(),
    } as any,
    ARTIFACTS_R2: {
      get: vi.fn(async () => null),
      put: vi.fn(),
    } as any,
    JWK_KV: {} as any,
    PROXY_SIGNING_KEY: undefined,
    ALLOWED_ORIGINS: "*",
    MANAGEMENT_ALLOWED_HOSTS: "localhost:8787 localhost:5173",
  });

  it("returns 400 when user id missing", async () => {
    const env = createEnv();
    const request = new Request("https://localhost:8787/_tribute/control/snapshot", {
      method: "GET",
      headers: { host: "localhost:8787" },
    });
    const res = await maybeHandleManagementRequest(request, env, undefined);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
  });

  it("builds snapshot for user", async () => {
    const env = createEnv();
    const request = new Request("https://localhost:8787/_tribute/control/snapshot", {
      method: "GET",
      headers: { "x-user-id": "user-1", host: "localhost:8787" },
    });
    const res = await maybeHandleManagementRequest(request, env, undefined);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.wallet.balance).toBe(42);
    expect(body.receipts).toHaveLength(1);
    expect(body.logs[0].id).toBe("r-1");
  });

  it("rejects snapshot when targeting header present", async () => {
    const env = createEnv();
    const request = new Request("https://localhost:8787/_tribute/control/snapshot", {
      method: "GET",
      headers: { "x-user-id": "user-1", host: "localhost:8787", "x-tribute-target": "merchant" },
    });
    const res = await maybeHandleManagementRequest(request, env, undefined);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it("allows forwarded host when whitelisted", async () => {
    const env = createEnv();
    const request = new Request("https://proxy/_tribute/control/snapshot", {
      method: "GET",
      headers: { "x-user-id": "user-1", host: "localhost:8787", "x-forwarded-host": "localhost:5173" },
    });
    const res = await maybeHandleManagementRequest(request, env, undefined);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });
});
