import { describe, expect, it } from "vitest";

import { metered } from "../../core/src";
import { withMeterx, createEstimateHandler, proxyExtensions } from "../src";

describe("withMeterx", () => {
  it("canonicalizes request and forwards call", async () => {
    const handler = metered({ pricing: "estimate-first" })(async () => ({ status: 200 }));
    (handler as any).estimate?.(() => ({ estimatedPrice: 0.2 }));

    const wrapped = withMeterx(handler as any);
    const req: any = {
      method: "POST",
      url: "/chat",
      headers: { "content-type": "application/json" },
      query: { prompt: "hi" },
      body: { prompt: "hi" },
    };
    const res: any = { status: 200 };

    await wrapped(req, res);

    expect(req.tributeCanonical).toBeDefined();
    const estimator = createEstimateHandler(handler as any);
    expect(estimator).toBeDefined();
    expect(proxyExtensions(handler as any).xProxy?.metered).toBeDefined();
  });
});
