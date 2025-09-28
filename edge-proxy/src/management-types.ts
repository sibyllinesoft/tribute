import type { Receipt } from "@tribute/durable-objects";

export interface HistoryEntry {
  ts: string;
  rid: string;
  finalPrice: number;
  currency: string;
  receiptId: string;
  contentHash: string | null;
  status: string;
  estimatedPrice?: number;
  policyVersion?: number;
  merchantId?: string;
}

export interface WalletSnapshot {
  balance: number;
  currency: string;
  reserved?: number;
  refreshedAt: string;
}

export interface DashboardSnapshot {
  wallet: WalletSnapshot;
  receipts: Receipt[];
  logs: ManagementLogEntry[];
  credits: CreditEntry[];
  subscriptions: SubscriptionEntry[];
  merchantSummaries: MerchantSummary[];
}

export interface MerchantSummary {
  merchantId: string;
  appId?: string | null;
  displayName: string;
  totalReceipts: number;
  totalRevenue: number;
  currency: string;
  lastReceiptAt?: string;
  lastReceiptAmount?: number;
}

export interface ManagementLogEntry {
  id: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: string;
  source?: string;
  requestId?: string;
}

export interface CreditEntry {
  id: string;
  amount: number;
  currency: string;
  source?: string;
  createdAt: string;
  type: "top_up" | "adjustment" | "refund";
}

export interface SubscriptionEntry {
  id: string;
  feature: string;
  status: "active" | "trialing" | "expired" | "paused";
  platform?: string;
  renewalAt?: string | null;
  plan?: string;
}

export interface ReceiptEventPayload {
  receipt: Receipt;
}

export type ManagementEvent =
  | { type: "receipt"; data: ReceiptEventPayload }
  | { type: "wallet"; data: WalletSnapshot };
