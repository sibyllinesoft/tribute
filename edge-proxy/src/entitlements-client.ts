export interface EntitlementAccessRequest {
  userId: string;
  merchantId: string;
  feature?: string;
  quotaKey?: string;
  consume?: boolean;
}

export interface EntitlementDecision {
  allowed: boolean;
  fallbackToMetered: boolean;
  reason?: string;
  upgradeUrl?: string;
  quotaRemaining?: number;
}

export class EntitlementsClient {
  constructor(private readonly namespace?: DurableObjectNamespace) {}

  async access(request: EntitlementAccessRequest): Promise<EntitlementDecision> {
    if (!this.namespace) {
      return { allowed: false, fallbackToMetered: true, reason: "entitlements_unconfigured" };
    }
    const id = this.namespace.idFromName(this.key(request.merchantId, request.userId));
    const stub = this.namespace.get(id);
    const res = await stub.fetch("https://entitlements/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      return {
        allowed: false,
        fallbackToMetered: true,
        reason: `entitlements_error:${res.status}`,
      };
    }
    const body = (await res.json()) as EntitlementDecision;
    return body;
  }

  private key(merchantId: string, userId: string): string {
    return `${merchantId}::${userId}`;
  }
}
