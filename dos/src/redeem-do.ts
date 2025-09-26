import type { RedeemDurableObjectEnv } from "./env";
import {
  RedeemBeginPayload,
  RedeemBeginResponse,
  RedeemCancelPayload,
  RedeemCommitPayload,
  RedeemState,
} from "./types";
import { createReceipt } from "./receipt";
import { WalletRpcClient } from "./wallet-rpc";

const JSON_HEADERS = { "content-type": "application/json" } as const;

import { DurableObjectBase } from "./do-base";

export class RedeemDurableObject extends DurableObjectBase {
  private readonly storage: DurableObjectStorage;
  private readonly walletClient: WalletRpcClient;

  constructor(state: DurableObjectState, env: RedeemDurableObjectEnv) {
    super(state, env);
    this.storage = state.storage;
    this.walletClient = new WalletRpcClient(env.USER_WALLET_DO);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: JSON_HEADERS,
      });
    }

    switch (url.pathname) {
      case "/begin":
        return this.handleBegin(await request.json());
      case "/commit":
        return this.handleCommit(await request.json());
      case "/cancel":
        return this.handleCancel(await request.json());
      default:
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: JSON_HEADERS,
        });
    }
  }

  private async handleBegin(raw: unknown): Promise<Response> {
    const payload = raw as RedeemBeginPayload;
    const existing = (await this.storage.get<RedeemState>(payload.nonce)) ?? undefined;
    if (existing) {
      if (existing.status === "redeemed") {
        return json({ status: "replay", receipt: existing.receipt });
      }
      if (existing.status === "pending") {
        return json({ status: "replay" });
      }
      if (existing.status === "cancelled") {
        return json({ status: "reject", reason: `nonce_cancelled:${existing.reason}` });
      }
    }

    const budget = await this.walletClient.checkBudget(payload);
    if (!budget.ok) {
      return json({ status: "reject", reason: budget.reason ?? "budget_rejected" });
    }

    const nextState: RedeemState = {
      status: "pending",
      nonce: payload.nonce,
      userId: payload.userId,
      merchantId: payload.merchantId,
      rid: payload.rid,
      method: payload.method,
      inputsHash: payload.inputsHash,
      maxPrice: payload.maxPrice,
      currency: payload.currency,
      policyVersion: payload.policyVersion,
      policyDigest: payload.policyDigest,
      tokenFingerprint: payload.tokenFingerprint,
      priceSig: payload.priceSig,
      pricingMode: payload.pricingMode,
      createdAt: new Date().toISOString(),
    };

    await this.storage.put(payload.nonce, nextState);
    return json({ status: "ok" });
  }

  private async handleCommit(raw: unknown): Promise<Response> {
    const payload = raw as RedeemCommitPayload;
    const current = (await this.storage.get<RedeemState>(payload.nonce)) ?? undefined;
    if (!current) {
      return json({ status: "reject", reason: "nonce_missing" }, 409);
    }
    if (current.status === "redeemed") {
      return json({ status: "replay", receipt: current.receipt });
    }
    if (current.status === "cancelled") {
      return json({ status: "reject", reason: `nonce_cancelled:${current.reason}` }, 409);
    }

    if (payload.policyVersion !== current.policyVersion) {
      return json({ status: "reject", reason: "policy_mismatch" }, 409);
    }
    if (payload.policyDigest !== current.policyDigest) {
      return json({ status: "reject", reason: "policy_digest_mismatch" }, 409);
    }
    if (payload.inputsHash !== current.inputsHash) {
      return json({ status: "reject", reason: "inputs_hash_mismatch" }, 409);
    }
    if (payload.finalPrice > current.maxPrice) {
      return json({ status: "reject", reason: "cap_exceeded" }, 409);
    }

    const debit = await this.walletClient.debit({
      nonce: payload.nonce,
      userId: payload.userId,
      merchantId: payload.merchantId,
      finalPrice: payload.finalPrice,
      currency: payload.currency,
      tokenFingerprint: payload.tokenFingerprint,
    });

    if (!debit.ok) {
      return json({ status: "reject", reason: debit.reason ?? "wallet_debit_failed" }, 409);
    }

    const receipt = createReceipt({
      nonce: payload.nonce,
      userId: payload.userId,
      merchantId: payload.merchantId,
      rid: payload.rid,
      inputsHash: payload.inputsHash,
      policyVersion: payload.policyVersion,
      policyDigest: payload.policyDigest,
      maxPrice: current.maxPrice,
      estimatedPrice: payload.estimatedPrice,
      finalPrice: payload.finalPrice,
      currency: payload.currency,
      contentHash: payload.contentHash,
      originStatus: payload.originStatus,
      originHeadersSubset: payload.originHeaders ?? {},
      tokenFingerprint: payload.tokenFingerprint,
      proxySignature: payload.proxySignature,
      estDigest: payload.estDigest,
      observablesDigest: payload.observablesDigest,
      finalPriceSig: payload.finalPriceSig,
      pricingMode: payload.pricingMode,
      pricingUnattested: payload.pricingUnattested,
    });

    const nextState: RedeemState = {
      status: "redeemed",
      nonce: payload.nonce,
      receipt,
    };

    await this.storage.put(payload.nonce, nextState);
    return json({ status: "ok", receipt });
  }

  private async handleCancel(raw: unknown): Promise<Response> {
    const payload = raw as RedeemCancelPayload;
    const current = (await this.storage.get<RedeemState>(payload.nonce)) ?? undefined;
    if (!current) {
      await this.storage.put(payload.nonce, {
        status: "cancelled",
        nonce: payload.nonce,
        cancelledAt: new Date().toISOString(),
        reason: payload.reason,
      });
      return json({ status: "ok" });
    }

    if (current.status === "redeemed") {
      return json({ status: "replay", receipt: current.receipt });
    }

    await this.storage.put(payload.nonce, {
      status: "cancelled",
      nonce: payload.nonce,
      cancelledAt: new Date().toISOString(),
      reason: payload.reason,
    });
    return json({ status: "ok" });
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
