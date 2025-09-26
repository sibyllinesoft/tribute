import { describe, expect, it } from "vitest";
import { canonicalizeRequest } from "../src";

const allowlist = ["content-type"]; 

describe("canonicalizeRequest", () => {
  it("normalizes json bodies and query order", () => {
    const canonical = canonicalizeRequest({
      method: "post",
      rawPath: "/llm/123",
      headerAllowlist: allowlist,
      headers: [["Content-Type", "application/json"], ["Ignored", "nope"]],
      query: [["b", "2"], ["a", "1"]],
      body: Buffer.from('{"beta":2,"alpha":1}'),
      pathParams: { chatId: 123 },
    });

    expect(canonical.method).toBe("POST");
    expect(canonical.pathTemplate).toBe("/llm/{chatId}");
    expect(canonical.headers).toEqual({ "content-type": ["application/json"] });
    expect(canonical.query).toEqual({ a: ["1"], b: ["2"] });
    expect(canonical.body?.asText()).toBe('{"alpha":1,"beta":2}');
  });

  it("hash diff changes when query differs", () => {
    const first = canonicalizeRequest({
      method: "get",
      rawPath: "/foo",
      headerAllowlist: [],
      headers: [],
      query: [["a", "1"]],
    });
    const second = canonicalizeRequest({
      method: "get",
      rawPath: "/foo",
      headerAllowlist: [],
      headers: [],
      query: [["a", "2"]],
    });

    expect(first.hash()).not.toBe(second.hash());
  });
});
