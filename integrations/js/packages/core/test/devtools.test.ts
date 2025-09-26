import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HmacSigner, verifySignature } from "../src/estimate";
import { diffOpenapi, simulateReceipt, verifyEstimateSignature } from "../src/devtools";

describe("devtools", () => {
  const makeTempFile = (name: string, content: object) => {
    const dir = mkdtempSync(join(tmpdir(), "tribute-devtools-"));
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(content));
    return path;
  };

  it("computes path diff", () => {
    const previous = makeTempFile("before.json", { paths: { "/old": {} } });
    const current = makeTempFile("after.json", { paths: { "/new": {} } });
    const diff = diffOpenapi(previous, current);
    expect(diff).toEqual({ addedPaths: ["/new"], removedPaths: ["/old"] });
  });

  it("verifies estimate signatures", () => {
    const signer = new HmacSigner("cli", Buffer.from("secret"));
    const token = signer.signEstimate(1.5, {});

    const payload = makeTempFile("payload.json", { price_signature: token });
    const jwks = makeTempFile("jwks.json", { keys: [{ kid: "cli", k: "secret" }] });

    const ok = verifyEstimateSignature(payload, jwks, verifySignature);
    expect(ok).toBe(true);
  });

  it("throws when payload lacks signature", () => {
    const payload = makeTempFile("payload.json", {});
    const jwks = makeTempFile("jwks.json", { keys: [] });
    expect(() => verifyEstimateSignature(payload, jwks, verifySignature)).toThrow(
      /payload missing price_signature/
    );
  });

  it("returns simulation placeholder", () => {
    expect(simulateReceipt()).toEqual({ status: "ok", message: "simulation placeholder" });
  });
});
