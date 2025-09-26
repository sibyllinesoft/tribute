import { describe, expect, it, vi } from "vitest";

import { metered } from "../../core/src";
import { registerMeterxRoute, proxyExtensions } from "../src";

describe("registerMeterxRoute", () => {
  it("normalizes requests and registers estimate route", async () => {
    const routes: any[] = [];
    const estimateHandlers: Array<(req: any, reply: any) => Promise<void>> = [];
    const instance = {
      route: vi.fn((config) => routes.push(config)),
      post: vi.fn((path: string, handler: any) => estimateHandlers.push(handler)),
    } as any;

    const handler = metered({ pricing: "estimate-first" })(
      async (_req: any, _reply: any, tracker: any) => {
        tracker.setUsage({ tokens: 2 });
        tracker.setFinalPrice(0.1);
        return { body: Buffer.from("ok"), usage: { tokens: 2 }, finalPrice: 0.1 };
      }
    );

    (handler as any).estimate?.(() => ({ estimatedPrice: 0.1 }));

    registerMeterxRoute(instance, "/chat", handler);

    expect(instance.route).toHaveBeenCalled();
    expect(instance.post).toHaveBeenCalledWith(
      "/chat/estimate",
      expect.any(Function)
    );

    const routeHandler = routes[0].handler;
    const request: any = {
      method: "POST",
      routerPath: "/chat/:id",
      url: "/chat/123",
      headers: { "content-type": "application/json" },
      query: { a: "1" },
      params: { id: "123" },
      body: { prompt: "hi" },
    };
    const reply: any = {
      sent: false,
      header: vi.fn(),
      send: vi.fn(),
    };

    await routeHandler(request, reply);

    expect(request.tributeCanonical).toBeDefined();
    expect(reply.header).toHaveBeenCalledWith(
      "x-tribute-usage",
      expect.stringContaining("tokens")
    );
    expect(reply.send).toHaveBeenCalledWith(Buffer.from("ok"));

    const estimatorReply: any = { send: vi.fn() };
    await estimateHandlers[0]({} as any, estimatorReply);
    expect(estimatorReply.send).toHaveBeenCalled();
  });
});

describe("proxyExtensions", () => {
  it("returns metadata", () => {
    const handler = metered({ pricing: "estimate-first" })(() => "ok");
    const metadata = proxyExtensions(handler);
    expect(metadata.xProxy?.metered).toBeDefined();
  });
});
