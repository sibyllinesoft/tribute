import { z } from "zod";

export const paymentTokenSchema = z.object({
  nonce: z.string(),
  sub: z.string(),
  mer: z.string(),
  rid: z.string(),
  method: z.string(),
  inputs_hash: z.string(),
  max_price: z.number().nonnegative(),
  ccy: z.string().min(3).max(3),
  policy_ver: z.number().int().nonnegative(),
  policy_digest: z.string().min(1),
  aud: z.literal("proxy"),
  iss: z.literal("tribute"),
  exp: z.number(),
  iat: z.number(),
  origin_host: z.string().min(1),
  price_sig: z.string(),
});

export type PaymentTokenClaims = z.infer<typeof paymentTokenSchema>;

export type PricingMode = "estimate-first" | "execute-only" | "estimate-is-final" | "subscription";

export interface RedeemBeginPayload {
  nonce: string;
  userId: string;
  merchantId: string;
  rid: string;
  method: string;
  inputsHash: string;
  maxPrice: number;
  currency: string;
  policyVersion: number;
  policyDigest: string;
  tokenFingerprint: string;
  pricingMode: PricingMode;
  priceSig: string;
}

export type RedeemBeginResponse =
  | { status: "ok" }
  | { status: "replay"; receipt?: Receipt }
  | { status: "reject"; reason: string };

export interface RedeemCommitPayload {
  nonce: string;
  rid: string;
  inputsHash: string;
  policyVersion: number;
  policyDigest: string;
  finalPrice: number;
  currency: string;
  userId: string;
  merchantId: string;
  estimatedPrice?: number;
  contentHash: string;
  originStatus: number;
  originHeaders?: Record<string, string>;
  tokenFingerprint: string;
  proxySignature: string;
  pricingMode: PricingMode;
  estDigest?: string;
  observablesDigest?: string;
  finalPriceSig?: string;
  pricingUnattested?: boolean;
}

export interface RedeemCancelPayload {
  nonce: string;
  reason: string;
}

export type RedeemState =
  | {
      status: "pending";
      nonce: string;
      userId: string;
      merchantId: string;
      rid: string;
      method: string;
      inputsHash: string;
      maxPrice: number;
      currency: string;
      policyVersion: number;
      policyDigest: string;
      tokenFingerprint: string;
      priceSig: string;
      pricingMode: PricingMode;
      createdAt: string;
    }
  | {
      status: "redeemed";
      nonce: string;
      receipt: Receipt;
    }
  | {
      status: "cancelled";
      nonce: string;
      cancelledAt: string;
      reason: string;
    };

export interface Receipt {
  receiptId: string;
  nonce: string;
  userId: string;
  merchantId: string;
  rid: string;
  inputsHash: string;
  policyVersion: number;
  policyDigest: string;
  maxPrice: number;
  estimatedPrice?: number;
  finalPrice: number;
  currency: string;
  timestamp: string;
  status: "paid" | "refunded";
  contentHash: string | null;
  originStatus: number | null;
  originHeadersSubset: Record<string, string>;
  tokenFingerprint: string;
  proxySignature: string;
  estDigest?: string;
  observablesDigest?: string;
  finalPriceSig?: string;
  pricingMode: PricingMode;
  pricingUnattested?: boolean;
}

export interface WalletCheckResult {
  ok: boolean;
  reason?: string;
}

export interface WalletDebitResult {
  ok: boolean;
  balanceAfter?: number;
  reason?: string;
}

export interface WalletClient {
  checkBudget(payload: RedeemBeginPayload): Promise<WalletCheckResult>;
  debit(payload: Pick<RedeemCommitPayload, "userId" | "merchantId" | "finalPrice" | "currency" | "tokenFingerprint"> & { nonce: string }): Promise<WalletDebitResult>;
  refund(receiptId: string): Promise<void>;
}

export const receiptCacheKey = (rid: string, inputsHash: string, policyVersion: number) =>
  `${rid}::${inputsHash}::${policyVersion}`;
