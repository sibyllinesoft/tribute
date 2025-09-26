import { decodeProtectedHeader, importJWK, jwtVerify, type JWTPayload } from "jose";
import { paymentTokenSchema, type PaymentTokenClaims } from "@tribute/durable-objects";
import type { ProxyEnv } from "./env";

export const extractBearer = (header: string | null): string | null => {
  if (!header) return null;
  const [, token] = header.split(" ", 2);
  return token ?? null;
};

export const verifyPaymentToken = async (token: string, env: ProxyEnv): Promise<PaymentTokenClaims> => {
  const jwks = (await env.JWK_KV.get("signing/jwks", "json")) as { keys: Array<Record<string, unknown>> } | null;
  if (!jwks) {
    throw new Error("jwks_missing");
  }
  const header = decodeProtectedHeader(token);
  if (!header.kid) {
    throw new Error("token_missing_kid");
  }
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    throw new Error(`jwk_not_found:${header.kid}`);
  }
  const key = await importJWK(jwk as any, header.alg);
  const { payload } = await jwtVerify(token, key, {
    issuer: "tribute",
    audience: "proxy",
    clockTolerance: 5,
  });
  return paymentTokenSchema.parse(normalizeClaims(payload));
};

const normalizeClaims = (payload: JWTPayload): Record<string, unknown> => ({
  nonce: payload.nonce,
  sub: payload.sub,
  mer: payload.mer,
  rid: payload.rid,
  method: payload.method,
  inputs_hash: payload.inputs_hash,
  max_price: payload.max_price,
  ccy: payload.ccy,
  policy_ver: payload.policy_ver,
  policy_digest: payload.policy_digest,
  aud: payload.aud,
  iss: payload.iss,
  exp: payload.exp,
  iat: payload.iat,
  origin_host: payload.origin_host,
  price_sig: payload.price_sig,
});
