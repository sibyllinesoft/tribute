import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

export function diffOpenapi(previousPath: string, currentPath: string) {
  const previous = safeReadJson(previousPath);
  const current = safeReadJson(currentPath);
  return {
    addedPaths: Object.keys(current.paths ?? {}).filter((path) => !(previous.paths ?? {})[path]).sort(),
    removedPaths: Object.keys(previous.paths ?? {}).filter((path) => !(current.paths ?? {})[path]).sort(),
  };
}

export function verifyEstimateSignature(payloadPath: string, jwksPath: string, verifier: (token: string, resolver: (kid: string) => Buffer | undefined) => boolean) {
  const payload = safeReadJson(payloadPath);
  const jwks = safeReadJson(jwksPath);
  const token = payload.price_signature ?? payload.priceSignature;
  if (!token) throw new Error("payload missing price_signature");

  const resolver = (kid: string) => {
    for (const key of jwks.keys ?? []) {
      if (key.kid === kid && key.k) {
        return Buffer.from(key.k, "utf8");
      }
    }
    return undefined;
  };
  return verifier(token, resolver);
}

export function simulateReceipt() {
  return { status: "ok", message: "simulation placeholder" };
}

function safeReadJson(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read JSON ${path}: ${error}`);
  }
}
