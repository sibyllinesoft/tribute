import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const workerEntry = resolve(repoRoot, "edge-proxy/src/index.ts");

const buildWorkerModule = async (): Promise<string> => {
  const result = await build({
    entryPoints: [workerEntry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: "inline",
    write: false,
  });
  const [{ text }] = result.outputFiles ?? [];
  if (!text) {
    throw new Error("Failed to bundle worker entry");
  }
  return text;
};

describe("edge proxy integration (miniflare)", () => {
  let mf: Miniflare;

  beforeAll(async () => {
    const script = await buildWorkerModule();
    mf = new Miniflare({
      compatibilityDate: "2024-03-25",
      modules: [
        {
          type: "ESModule",
          path: "index.mjs",
          contents: script,
        },
      ],
      bindings: {
        ENVIRONMENT: "test",
      },
    });
  }, 20000);

  afterAll(async () => {
    await mf.dispose();
  });

  it("rejects requests without payment token", async () => {
    const res = await mf.dispatchFetch("https://example.com/v1/demo");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "missing_token" });
  });
});
