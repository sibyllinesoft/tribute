import { type PricingMode, type Receipt } from "./types";

export interface ReceiptFactoryOptions {
  receiptId?: string;
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

export const createReceipt = (opts: ReceiptFactoryOptions): Receipt => ({
  receiptId: opts.receiptId ?? crypto.randomUUID(),
  nonce: opts.nonce,
  userId: opts.userId,
  merchantId: opts.merchantId,
  rid: opts.rid,
  inputsHash: opts.inputsHash,
  policyVersion: opts.policyVersion,
  policyDigest: opts.policyDigest,
  maxPrice: opts.maxPrice,
  estimatedPrice: opts.estimatedPrice,
  finalPrice: opts.finalPrice,
  currency: opts.currency,
  timestamp: new Date().toISOString(),
  status: "paid",
  contentHash: opts.contentHash,
  originStatus: opts.originStatus,
  originHeadersSubset: opts.originHeadersSubset,
  tokenFingerprint: opts.tokenFingerprint,
  proxySignature: opts.proxySignature,
  estDigest: opts.estDigest,
  observablesDigest: opts.observablesDigest,
  finalPriceSig: opts.finalPriceSig,
  pricingMode: opts.pricingMode,
  pricingUnattested: opts.pricingUnattested,
});
