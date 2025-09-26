import type { MerchantConfig } from "@tribute/durable-objects";

export class MerchantClient {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  async getConfig(merchantId: string): Promise<MerchantConfig> {
    const stub = this.namespace.get(this.namespace.idFromName(merchantId));
    const res = await stub.fetch("https://merchant/config", { method: "GET" });
    if (!res.ok) {
      throw new Error(`merchant_config_missing:${merchantId}`);
    }
    return (await res.json()) as MerchantConfig;
  }
}
