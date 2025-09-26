export interface TributeDurableObjectEnv {
  USER_WALLET_DO: DurableObjectNamespace;
  MERCHANT_DO: DurableObjectNamespace;
  HISTORY_DO: DurableObjectNamespace;
  RECEIPTS_KV: KVNamespace;
  NONCES_KV: KVNamespace;
}

export interface RedeemDurableObjectEnv extends TributeDurableObjectEnv {}

export interface WalletDurableObjectEnv {
  STRIPE_WEBHOOK_QUEUE?: Queue;
}

export interface Queue {
  send(body: unknown): Promise<void>;
}
