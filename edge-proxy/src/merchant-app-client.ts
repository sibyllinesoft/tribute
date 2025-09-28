import type { MerchantAppConfig } from "@tribute/durable-objects";

export class MerchantAppClient {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  async getConfig(appId: string): Promise<MerchantAppConfig | null> {
    const stub = this.namespace.get(this.namespace.idFromName(appId));
    const res = await stub.fetch("https://merchant-app/config", { method: "GET" });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`merchant_app_config_missing:${appId}`);
    }
    return (await res.json()) as MerchantAppConfig;
  }
}
