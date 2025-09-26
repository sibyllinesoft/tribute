import { DurableObjectBase } from "./do-base";

interface WalletState {
  balance: number;
  currency: string;
  processedFingerprints: Record<string, number>;
  perMerchantSpend: Record<string, number>;
  budgets: {
    dailyCap?: number;
    perMerchantCap?: Record<string, number>;
  };
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

export class UserWalletDurableObject extends DurableObjectBase {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState, _env: unknown) {
    super(state, _env);
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "GET" && url.pathname === "/state") {
      const state = await this.state();
      return json(state);
    }

    const body = method === "POST" ? await request.json() : {};

    switch (url.pathname) {
      case "/check-budget":
        return this.handleCheckBudget(body);
      case "/debit":
        return this.handleDebit(body);
      case "/fund":
        return this.handleFund(body);
      case "/configure":
        return this.handleConfigure(body);
      case "/refund":
        return this.handleRefund(body);
      default:
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: JSON_HEADERS });
    }
  }

  private async state(): Promise<WalletState> {
    const existing = await this.storage.get<WalletState>("wallet");
    if (existing) {
      return existing;
    }
    const initial: WalletState = {
      balance: 0,
      currency: "USD",
      processedFingerprints: {},
      perMerchantSpend: {},
      budgets: {},
    };
    await this.storage.put("wallet", initial);
    return initial;
  }

  private async persist(next: WalletState): Promise<void> {
    await this.storage.put("wallet", next);
  }

  private async handleCheckBudget(body: any): Promise<Response> {
    const state = await this.state();
    const maxPrice = Number(body.maxPrice ?? 0);
    if (Number.isNaN(maxPrice) || maxPrice < 0) {
      return json({ ok: false, reason: "invalid_cap" });
    }
    if (maxPrice > state.balance) {
      return json({ ok: false, reason: "insufficient_funds" });
    }
    const merchantId = String(body.merchantId ?? "");
    const perMerchantCap = state.budgets.perMerchantCap?.[merchantId];
    if (perMerchantCap !== undefined) {
      const nextSpend = (state.perMerchantSpend[merchantId] ?? 0) + maxPrice;
      if (nextSpend > perMerchantCap) {
        return json({ ok: false, reason: "merchant_cap_exceeded" });
      }
    }
    return json({ ok: true });
  }

  private async handleDebit(body: any): Promise<Response> {
    const state = await this.state();
    const finalPrice = Number(body.finalPrice ?? 0);
    if (Number.isNaN(finalPrice) || finalPrice < 0) {
      return json({ ok: false, reason: "invalid_amount" }, 400);
    }
    const fingerprint = String(body.tokenFingerprint ?? "");
    if (!fingerprint) {
      return json({ ok: false, reason: "missing_fingerprint" }, 400);
    }

    if (state.processedFingerprints[fingerprint]) {
      return json({ ok: true, balanceAfter: state.balance });
    }

    if (finalPrice > state.balance) {
      return json({ ok: false, reason: "insufficient_funds" }, 409);
    }

    const merchantId = String(body.merchantId ?? "");
    const nextBalance = state.balance - finalPrice;
    const nextSpend = (state.perMerchantSpend[merchantId] ?? 0) + finalPrice;

    const nextState: WalletState = {
      ...state,
      balance: nextBalance,
      processedFingerprints: { ...state.processedFingerprints, [fingerprint]: finalPrice },
      perMerchantSpend: { ...state.perMerchantSpend, [merchantId]: nextSpend },
    };

    await this.persist(nextState);
    return json({ ok: true, balanceAfter: nextBalance });
  }

  private async handleFund(body: any): Promise<Response> {
    const amount = Number(body.amount ?? 0);
    if (Number.isNaN(amount) || amount < 0) {
      return json({ ok: false, reason: "invalid_amount" }, 400);
    }
    const state = await this.state();
    const nextState: WalletState = { ...state, balance: state.balance + amount };
    await this.persist(nextState);
    return json({ ok: true, balanceAfter: nextState.balance });
  }

  private async handleConfigure(body: any): Promise<Response> {
    const state = await this.state();
    const nextState: WalletState = {
      ...state,
      budgets: {
        dailyCap: body.dailyCap ?? state.budgets.dailyCap,
        perMerchantCap: body.perMerchantCap ?? state.budgets.perMerchantCap,
      },
    };
    await this.persist(nextState);
    return json({ ok: true });
  }

  private async handleRefund(body: any): Promise<Response> {
    const receiptId = body.receiptId as string | undefined;
    if (!receiptId) {
      return json({ ok: false, reason: "missing_receipt" }, 400);
    }
    return json({ ok: true });
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
