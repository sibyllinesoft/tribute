import { describe, expect, it } from "vitest";
import { withMeterx, proxyExtensions } from "../src/index";
import { metered } from "../../core/src";

describe("withMeterx", () => {
  it("attaches canonical request to express request", async () => {
    const handler = metered({ pricing: "estimate-first" })(async () => ({ body: "ok" }));
    const middleware = withMeterx(handler as any);

    const req: any = {
      method: "GET",
      path: "/foo/123",
      headers: { "content-type": "application/json" },
      query: { a: "1" },
      params: { id: 123 },
      body: { hello: "world" },
    };

    let statusSent = false;
    const res: any = {
      headers: {} as Record<string, string>,
      send(payload: unknown) {
        statusSent = true;
        this.payload = payload;
      },
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      get headersSent() {
        return statusSent;
      },
    };

    await middleware(req as any, res as any, () => undefined);

    expect(req.tributeCanonical).toBeDefined();
    expect(res.payload.toString()).toBe("ok");
    expect(res.headers["x-tribute-usage"]).toBeDefined();
  });
});

describe("proxyExtensions", () => {
  it("returns metadata", () => {
    const handler = metered({ pricing: "estimate-first" })(() => "ok");
    const metadata = proxyExtensions(handler as any);
    expect(metadata.xProxy).toBeDefined();
  });
});
