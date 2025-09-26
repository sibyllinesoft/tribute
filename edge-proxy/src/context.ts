import type { PaymentTokenClaims } from "@tribute/durable-objects";
import { sha256Base64Url } from "./crypto";

export interface ClientContextToken {
  token: string;
  issuer?: string;
}

export const buildProxyContextHeader = async (
  claims: PaymentTokenClaims,
  stableUserId: string,
  opts: { appId?: string; mandateId?: string; budgetEpoch?: string; uaSignature?: string; ipHash?: string }
): Promise<string> => {
  const payload = {
    iss: "tribute",
    aud: claims.origin_host,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    sub: `${stableUserId}@${claims.mer}`,
    app: opts.appId ?? null,
    roles: [],
    scopes: [],
    mandate: opts.mandateId ?? null,
    budget_epoch: opts.budgetEpoch ?? null,
    rid: claims.rid,
    method: claims.method,
    inputs_hash: claims.inputs_hash,
    receipt_nonce: claims.nonce,
    path_tmpl: claims.rid,
    ua_sig: opts.uaSignature ?? null,
    ip_hash: opts.ipHash ?? null,
  };

  const serialized = JSON.stringify(payload);
  const signature = await sha256Base64Url(serialized);
  return `${btoa(serialized)}.${signature}`;
};
