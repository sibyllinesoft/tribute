import { describe, expect, it } from "vitest";

import { buildProxyMetadata, applyOpenapiExtensions } from "../src/openapi";
import { MethodSemantics } from "../src/decorators";

describe("openapi helpers", () => {
  it("merges proxy metadata", () => {
    const semantics: MethodSemantics = {
      metered: { policyVer: 3 },
      entitlement: { feature: "pro" },
    };
    const metadata = buildProxyMetadata(semantics);
    const doc: Record<string, any> = {};

    const result = applyOpenapiExtensions({
      document: doc,
      path: "/chat",
      method: "POST",
      metadata,
    });

    const operation = result.paths["/chat"].post;
    expect(operation["x-proxy"].metered.policyVer).toBe(3);
    expect(operation["x-proxy"].entitlement.feature).toBe("pro");
  });

  it("skips when no metadata present", () => {
    const metadata = buildProxyMetadata({});
    const doc = { paths: { "/chat": { get: { summary: "ok" } } } };
    const result = applyOpenapiExtensions({ document: doc, path: "/chat", method: "GET", metadata });
    expect(result.paths["/chat"].get).toEqual({ summary: "ok" });
  });
});
