import { createHmac } from "node:crypto";

export interface EstimateResult {
  estimatedPrice: number;
  observables: Record<string, unknown>;
  priceSignature?: string;
}

export interface Signer {
  keyId: string;
  signEstimate(price: number, observables: Record<string, unknown>): string;
}

export class HmacSigner implements Signer {
  constructor(public readonly keyId: string, private readonly secret: Buffer) {}

  signEstimate(price: number, observables: Record<string, unknown>): string {
    const header = { alg: "HS256", kid: this.keyId, typ: "JOSE" } satisfies Record<string, unknown>;
    const payload = { price, observables } satisfies Record<string, unknown>;
    const encodedHeader = b64url(JSON.stringify(header));
    const encodedPayload = b64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", this.secret).update(signingInput).digest();
    return `${signingInput}.${b64url(signature)}`;
  }

  secretBytes(): Buffer {
    return Buffer.from(this.secret);
  }
}

export class JWKSManager {
  private readonly signers = new Map<string, HmacSigner>();

  register(signer: HmacSigner) {
    this.signers.set(signer.keyId, signer);
  }

  resolve(keyId: string) {
    return this.signers.get(keyId);
  }

  jwks() {
    return {
      keys: [...this.signers.values()].map((signer) => ({
        kid: signer.keyId,
        kty: "oct",
        alg: "HS256",
      })),
    };
  }
}

export function estimate(options: {
  estimatedPrice: number;
  observables?: Record<string, unknown>;
  signer?: Signer;
}): EstimateResult {
  const observables = options.observables ?? {};
  const priceSignature = options.signer?.signEstimate(options.estimatedPrice, observables);
  return {
    estimatedPrice: round(options.estimatedPrice),
    observables,
    priceSignature,
  } satisfies EstimateResult;
}

export function verifySignature(
  token: string,
  resolver: (kid: string) => Buffer | undefined,
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: { kid?: string; alg?: string };
  try {
    header = JSON.parse(Buffer.from(padB64(encodedHeader), "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (!header.kid) return false;
  const secret = resolver(header.kid);
  if (!secret) return false;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = createHmac("sha256", secret).update(signingInput).digest();
  const provided = Buffer.from(padB64(encodedSignature), "base64url");
  return timingSafeEqual(expected, provided);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function b64url(input: string | Buffer): string {
  const buffer = typeof input === "string" ? Buffer.from(input) : input;
  return buffer.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function padB64(input: string): string {
  const pad = (4 - (input.length % 4)) % 4;
  return input + "=".repeat(pad);
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let idx = 0; idx < a.length; idx += 1) {
    result |= a[idx] ^ b[idx];
  }
  return result === 0;
}
