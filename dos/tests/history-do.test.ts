import { describe, expect, it } from "vitest";

import { HistoryDurableObject } from "../src/history-do";

const createDO = () => {
  const state: Record<string, any> = {};
  const storage = {
    get: async (key: string) => state[key] ?? null,
    put: async (key: string, value: unknown) => {
      state[key] = value;
    },
  } as any;
  const durable = new HistoryDurableObject({ storage } as any);
  return { durable };
};

describe("HistoryDurableObject", () => {
  it("appends entries and paginates", async () => {
    const { durable } = createDO();
    for (let i = 0; i < 25; i += 1) {
      await durable.fetch(
        new Request("https://history/append", {
          method: "POST",
          body: JSON.stringify({
            ts: new Date().toISOString(),
            rid: `rid-${i}`,
            finalPrice: i,
            currency: "USD",
            receiptId: `r-${i}`,
            contentHash: `hash-${i}`,
            status: "paid",
          }),
        })
      );
    }

    const first = await durable.fetch(new Request("https://history/list", { method: "GET" }));
    const firstBody = await first.json();
    expect(firstBody.entries).toHaveLength(20);
    expect(firstBody.nextCursor).toBe(20);

    const second = await durable.fetch(
      new Request("https://history/list?cursor=20", { method: "GET" })
    );
    const secondBody = await second.json();
    expect(secondBody.entries).toHaveLength(5);
    expect(secondBody.nextCursor).toBeNull();
  });
});
