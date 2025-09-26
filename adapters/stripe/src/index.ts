export interface FundingAdapter {
  fund(params: { userId: string; amount: number; currency: string }): Promise<{ ok: boolean; checkoutUrl?: string }>;
  hold(params: { merchantId: string; amount: number; currency: string }): Promise<{ ok: boolean; holdId?: string }>;
  release(holdId: string): Promise<{ ok: boolean }>;
  settle(params: { merchantId: string; amount: number; currency: string }): Promise<{ ok: boolean }>;
}

export class StripeCreditsAdapter implements FundingAdapter {
  constructor(private readonly opts: { publishableKey: string; secretKey: string }) {}

  async fund(params: { userId: string; amount: number; currency: string }): Promise<{ ok: boolean; checkoutUrl?: string }> {
    const query = new URLSearchParams({
      amount: params.amount.toString(),
      currency: params.currency,
      user_id: params.userId,
    });
    return {
      ok: true,
      checkoutUrl: `https://dashboard.stripe.com/pay/${query.toString()}`,
    };
  }

  async hold(_params: { merchantId: string; amount: number; currency: string }): Promise<{ ok: boolean; holdId?: string }> {
    return { ok: true, holdId: "stripe-hold-stub" };
  }

  async release(_holdId: string): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async settle(_params: { merchantId: string; amount: number; currency: string }): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}
