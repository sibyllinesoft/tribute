import { describe, expect, it } from "vitest";
import { cacheable, metered, estimateHandler, resolveSemantics } from "../src";

const handler = cacheable({ ttl: 60 })(metered({ pricing: "estimate-first", policyVer: 3 })(() => "ok"));

(handler as any).estimate(() => ({ estimatedPrice: 1 }));

describe("decorators", () => {
  it("collects semantics", () => {
    const semantics = resolveSemantics(handler);
    expect(semantics.cacheable).toEqual({ ttl: 60 });
    expect(semantics.metered).toEqual({ pricing: "estimate-first", policyVer: 3 });
  });

  it("returns estimate handler helper", () => {
    expect(estimateHandler(handler)).toBeTypeOf("function");
  });
});
