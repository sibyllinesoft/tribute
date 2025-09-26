import { describe, expect, it } from "vitest";

import { metered } from "../../core/src";
import { MeterxInterceptor, proxyExtensions } from "../src";

describe("MeterxInterceptor", () => {
  it("stores canonical request on Nest request object", () => {
    const interceptor = new MeterxInterceptor();
    const handler = { handle: () => ({ subscribe() {} }) } as any;
    const request: any = {
      method: "GET",
      url: "/chat",
      headers: { accept: "application/json" },
      query: { a: "1" },
      params: {},
      body: { prompt: "hi" },
      rawBody: Buffer.from("{}"),
    };
    const context: any = {
      switchToHttp: () => ({ getRequest: () => request }),
    };

    interceptor.intercept(context, handler as any);
    expect(request.tributeCanonical).toBeDefined();
  });
});

describe("proxyExtensions", () => {
  it("returns metadata from semantics", () => {
    const handler = metered({ pricing: "estimate-first" })(() => "ok");
    const metadata = proxyExtensions(handler as any);
    expect(metadata.xProxy?.metered).toBeDefined();
  });
});
