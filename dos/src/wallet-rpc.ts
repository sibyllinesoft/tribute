import type { WalletClient, WalletCheckResult, WalletDebitResult, RedeemBeginPayload } from "./types";

export class WalletRpcClient implements WalletClient {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  async checkBudget(payload: RedeemBeginPayload): Promise<WalletCheckResult> {
    const res = await this.fetchWallet(payload.userId, "/check-budget", payload);
    return (await res.json()) as WalletCheckResult;
  }

  async debit(payload: {
    nonce: string;
    userId: string;
    merchantId: string;
    finalPrice: number;
    currency: string;
    tokenFingerprint: string;
  }): Promise<WalletDebitResult> {
    const res = await this.fetchWallet(payload.userId, "/debit", payload);
    return (await res.json()) as WalletDebitResult;
  }

  async refund(receiptId: string): Promise<void> {
    await this.fetchWallet("global", "/refund", { receiptId });
  }

  private async fetchWallet(userId: string, path: string, body: unknown): Promise<Response> {
    const id = this.namespace.idFromName(userId);
    const stub = this.namespace.get(id);
    return stub.fetch(`https://wallet${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
