export interface FundingAdapter {
  fund(params: { userId: string; amount: number; currency: string }): Promise<{ ok: boolean }>;
  hold(params: { merchantId: string; amount: number; currency: string }): Promise<{ ok: boolean; holdId?: string }>;
  release(holdId: string): Promise<{ ok: boolean }>;
  settle(params: { merchantId: string; amount: number; currency: string }): Promise<{ ok: boolean }>;
}

export class AP2Adapter implements FundingAdapter {
  async fund(_params: { userId: string; amount: number; currency: string }): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async hold(_params: { merchantId: string; amount: number; currency: string }): Promise<{ ok: boolean; holdId?: string }> {
    return { ok: false };
  }

  async release(_holdId: string): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async settle(_params: { merchantId: string; amount: number; currency: string }): Promise<{ ok: boolean }> {
    return { ok: false };
  }
}
