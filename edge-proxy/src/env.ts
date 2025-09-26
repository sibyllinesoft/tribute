import type { MerchantConfig, Receipt } from "@tribute/durable-objects";

export interface ProxyEnv {
  REDEEM_DO: DurableObjectNamespace;
  MERCHANT_DO: DurableObjectNamespace;
  USER_WALLET_DO: DurableObjectNamespace;
  HISTORY_DO: DurableObjectNamespace;
  ENTITLEMENTS_DO?: DurableObjectNamespace;
  RECEIPTS_KV: KVNamespace;
  ARTIFACTS_R2: R2Bucket;
  JWK_KV: KVNamespace;
  ORIGIN_SECRETS?: KVNamespace;
  PROXY_SIGNING_KEY?: string;
  ALLOWED_ORIGINS?: string;
}

export interface CachedReceipt {
  receipt: Receipt;
  content: ArrayBuffer | null;
  contentType?: string;
}

export interface CachedEstimate {
  estimatedPrice: number;
  currency: string;
  policyVersion: number;
  policyDigest: string;
  priceSig?: string | null;
  estDigest: string;
  expiresAt: number;
  estimateIsFinal?: boolean;
}

export interface MerchantLookup {
  config: MerchantConfig;
}
