import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RedeemDurableObject } from "../src/redeem-do";

const walletMock = {
  checkBudget: vi.fn(async () => ({ ok: true })),
  debit: vi.fn(async () => ({ ok: true })),
  refund: vi.fn(async () => undefined),
};

vi.mock("../src/wallet-rpc", () => ({
  WalletRpcClient: class {
    constructor() {
      return walletMock as any;
    }
  },
}));

const createDO = () => {
  const state: Record<string, any> = {};
  const storage = {
    get: vi.fn(async (key: string) => state[key] ?? null),
    put: vi.fn(async (key: string, value: unknown) => {
      state[key] = value;
    }),
  } as any;
  const durable = new RedeemDurableObject({ storage } as any, { USER_WALLET_DO: {} } as any);
  return { durable, storage, state };
};

describe("RedeemDurableObject", () => {
  let durable: RedeemDurableObject;
  let storage: any;
  let state: Record<string, any>;

  const beginPayload = {
    nonce: "nonce",
    userId: "user",
    merchantId: "merchant",
    rid: "GET:/chat",
    method: "POST",
    inputsHash: "hash",
    maxPrice: 10,
    currency: "USD",
    policyVersion: 1,
    policyDigest: "digest",
    tokenFingerprint: "fp",
    pricingMode: "estimate-first" as const,
    priceSig: "sig",
  };

  const commitPayload = {
    nonce: "nonce",
    rid: "GET:/chat",
    inputsHash: "hash",
    policyVersion: 1,
    policyDigest: "digest",
    finalPrice: 5,
    currency: "USD",
    userId: "user",
    merchantId: "merchant",
    contentHash: "hash",
    originStatus: 200,
    tokenFingerprint: "fp",
    proxySignature: "sig",
    pricingMode: "estimate-first" as const,
  };

  beforeEach(() => {
    const created = createDO();
    durable = created.durable;
    storage = created.storage;
    state = created.state;
    walletMock.checkBudget.mockClear();
    walletMock.debit.mockClear();
    walletMock.refund.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("begins redeem when budget ok", async () => {
    const res = await durable.fetch(
      new Request("https://redeem/begin", { method: "POST", body: JSON.stringify(beginPayload) })
    );
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(storage.put).toHaveBeenCalled();
    expect(walletMock.checkBudget).toHaveBeenCalled();
  });

  it("returns replay when nonce already redeemed", async () => {
    state[beginPayload.nonce] = {
      status: "redeemed",
      nonce: beginPayload.nonce,
      receipt: { receiptId: "r1" },
    };
    const res = await durable.fetch(
      new Request("https://redeem/begin", { method: "POST", body: JSON.stringify(beginPayload) })
    );
    const body = await res.json();
    expect(body.status).toBe("replay");
    expect(body.receipt.receiptId).toBe("r1");
  });

  it("rejects begin when budget fails", async () => {
    walletMock.checkBudget.mockResolvedValueOnce({ ok: false, reason: "budget_rejected" });
    const res = await durable.fetch(
      new Request("https://redeem/begin", { method: "POST", body: JSON.stringify(beginPayload) })
    );
    const body = await res.json();
    expect(body.status).toBe("reject");
    expect(body.reason).toBe("budget_rejected");
  });

  it("commits receipt when validation passes", async () => {
    state[beginPayload.nonce] = { status: "pending", ...beginPayload, createdAt: new Date().toISOString() };
    const res = await durable.fetch(
      new Request("https://redeem/commit", { method: "POST", body: JSON.stringify(commitPayload) })
    );
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.receipt.finalPrice).toBe(5);
    expect(walletMock.debit).toHaveBeenCalled();
    expect(state[beginPayload.nonce].status).toBe("redeemed");
  });

  it("rejects commit when policy mismatches", async () => {
    state[beginPayload.nonce] = { status: "pending", ...beginPayload, createdAt: new Date().toISOString() };
    const res = await durable.fetch(
      new Request("https://redeem/commit", {
        method: "POST",
        body: JSON.stringify({ ...commitPayload, policyVersion: 2 }),
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("reject");
    expect(walletMock.debit).not.toHaveBeenCalled();
  });

  it("cancels nonce", async () => {
    state[beginPayload.nonce] = { status: "pending", ...beginPayload, createdAt: new Date().toISOString() };
    const res = await durable.fetch(
      new Request("https://redeem/cancel", {
        method: "POST",
        body: JSON.stringify({ nonce: beginPayload.nonce, reason: "timeout" }),
      })
    );
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(state[beginPayload.nonce].status).toBe("cancelled");
  });
});
