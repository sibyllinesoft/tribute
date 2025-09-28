import type { ProxyEnv, CachedReceipt, CachedEstimate } from "./env";
import type { Receipt } from "@tribute/durable-objects";

export const RECEIPT_ID_PREFIX = "receipt-id::";

export const receiptIdCacheKey = (receiptId: string): string => `${RECEIPT_ID_PREFIX}${receiptId}`;

export const getCachedReceipt = async (env: ProxyEnv, key: string): Promise<CachedReceipt | null> => {
  const serialized = await env.RECEIPTS_KV.get(key, "json");
  if (!serialized) {
    return null;
  }
  const receipt = serialized as Receipt;
  let content: ArrayBuffer | null = null;
  let contentType: string | undefined;
  if (receipt.contentHash) {
    const object = await env.ARTIFACTS_R2.get(receipt.contentHash);
    if (object) {
      content = await object.arrayBuffer();
      contentType = object.httpMetadata?.contentType;
    }
  }
  return { receipt, content, contentType };
};

export const putReceiptAndArtifact = async (
  env: ProxyEnv,
  key: string,
  receipt: Receipt,
  body: ArrayBuffer,
  metadata: { contentType?: string; cacheControl?: string }
) => {
  await env.RECEIPTS_KV.put(key, JSON.stringify(receipt), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
  await env.RECEIPTS_KV.put(receiptIdCacheKey(receipt.receiptId), JSON.stringify(receipt), {
    expirationTtl: 60 * 60 * 24 * 30,
    metadata: {
      userId: receipt.userId,
      merchantId: receipt.merchantId,
      timestamp: receipt.timestamp,
    },
  });
  if (receipt.contentHash) {
    await env.ARTIFACTS_R2.put(receipt.contentHash, body, {
      httpMetadata: {
        contentType: metadata.contentType,
        cacheControl: metadata.cacheControl ?? "public, max-age=604800",
      },
    });
  }
};

const estimateKey = (key: string) => `estimate::${key}`;

export const getCachedEstimate = async (env: ProxyEnv, key: string): Promise<CachedEstimate | null> => {
  const serialized = await env.RECEIPTS_KV.get(estimateKey(key), "json");
  if (!serialized) {
    return null;
  }
  const entry = serialized as CachedEstimate;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    await env.RECEIPTS_KV.delete(estimateKey(key));
    return null;
  }
  return entry;
};

export const putCachedEstimate = async (
  env: ProxyEnv,
  key: string,
  entry: Omit<CachedEstimate, "expiresAt">,
  ttlSeconds: number
): Promise<void> => {
  const payload: CachedEstimate = {
    ...entry,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  await env.RECEIPTS_KV.put(estimateKey(key), JSON.stringify(payload), {
    expirationTtl: ttlSeconds,
  });
};
