import { describe, expect, it, beforeEach, vi } from "vitest";

import { UserWalletDurableObject } from "../src/user-wallet-do";

const createDO = () => {
  const state: Record<string, any> = {};
  const storage = {
    get: vi.fn(async (key: string) => state[key] ?? null),
    put: vi.fn(async (key: string, value: unknown) => {
      state[key] = value;
    }),
  } as any;

  const durable = new UserWalletDurableObject({ storage } as any, {} as any);
  return { durable, storage, state };
};

describe("UserWalletDurableObject", () => {
  let durable: UserWalletDurableObject;
  let storage: any;

  beforeEach(() => {
    const created = createDO();
    durable = created.durable;
    storage = created.storage;
  });

  it("returns initial state", async () => {
    const res = await durable.fetch(new Request("https://wallet/state", { method: "GET" }));
    const body = await res.json();
    expect(body.balance).toBe(0);
    expect(storage.put).toHaveBeenCalledWith("wallet", expect.any(Object));
  });

  it("rejects invalid budget check", async () => {
    const res = await durable.fetch(
      new Request("https://wallet/check-budget", {
        method: "POST",
        body: JSON.stringify({ maxPrice: -5 }),
      })
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("invalid_cap");
  });

  it("rejects debit when insufficient funds", async () => {
    const res = await durable.fetch(
      new Request("https://wallet/debit", {
        method: "POST",
        body: JSON.stringify({ finalPrice: 10, tokenFingerprint: "fp", merchantId: "m" }),
      })
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("insufficient_funds");
  });

  it("funds wallet and debits", async () => {
    await durable.fetch(
      new Request("https://wallet/fund", {
        method: "POST",
        body: JSON.stringify({ amount: 20 }),
      })
    );
    const debit = await durable.fetch(
      new Request("https://wallet/debit", {
        method: "POST",
        body: JSON.stringify({ finalPrice: 5, tokenFingerprint: "fp", merchantId: "m" }),
      })
    );
    const debitBody = await debit.json();
    expect(debitBody.ok).toBe(true);
    expect(debitBody.balanceAfter).toBe(15);
  });

  it("configures budgets", async () => {
    const res = await durable.fetch(
      new Request("https://wallet/configure", {
        method: "POST",
        body: JSON.stringify({ dailyCap: 100 }),
      })
    );
    expect(res.status).toBe(200);
    const state = await durable.fetch(new Request("https://wallet/state", { method: "GET" }));
    const body = await state.json();
    expect(body.budgets.dailyCap).toBe(100);
  });

  it("rejects refund without receipt", async () => {
    const res = await durable.fetch(
      new Request("https://wallet/refund", { method: "POST", body: JSON.stringify({}) })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("missing_receipt");
  });
});
