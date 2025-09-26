import type { NextFunction, Request, Response, Router } from "express";
import {
  buildProxyMetadata,
  canonicalizeRequest,
  estimateHandler,
  resolveSemantics,
  UsageTracker,
} from "@tribute/core";

const DEFAULT_HEADER_ALLOWLIST = ["authorization", "content-type", "accept"];

export function withMeterx(handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>, headerAllowlist = DEFAULT_HEADER_ALLOWLIST) {
  const semantics = resolveSemantics(handler);

  return async function tributeMiddleware(req: Request, res: Response, next: NextFunction) {
    const tracker = new UsageTracker();
    const canonical = canonicalizeRequest({
      method: req.method,
      rawPath: req.path,
      headerAllowlist,
      headers: iterateHeaders(req),
      query: iterateQuery(req),
      body: extractBody(req),
      pathParams: req.params,
    });
    (req as any).tributeCanonical = canonical;

    try {
      const result = await handler(req, res, next);
      if (res.headersSent) return result;
      if (result && typeof result === "object" && "body" in result) {
        const bodyBuffer = toBuffer((result as any).body);
        tracker.addChunk(bodyBuffer);
        if ((result as any).usage) tracker.setUsage((result as any).usage);
        if ((result as any).finalPrice !== undefined) tracker.setFinalPrice((result as any).finalPrice);
        res.setHeader("x-tribute-usage", JSON.stringify(tracker.build()));
        res.send(bodyBuffer);
        return undefined;
      }
      return result;
    } catch (error) {
      next(error);
      return undefined;
    }
  };
}

export function registerEstimateRoute(router: Router, path: string, handler: any) {
  const estimator = estimateHandler(handler);
  if (!estimator) return;
  router.post(`${path}/estimate`, async (req: Request, res: Response) => {
    const result = await estimator(req);
    res.json(result);
  });
}

export function proxyExtensions(handler: any) {
  return buildProxyMetadata(resolveSemantics(handler));
}

function iterateHeaders(req: Request) {
  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        entries.push([name, entry ?? ""]);
      }
    } else if (value !== undefined) {
      entries.push([name, String(value)]);
    }
  }
  return entries;
}

function iterateQuery(req: Request) {
  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        entries.push([name, String(entry)]);
      }
    } else if (value !== undefined) {
      entries.push([name, String(value)]);
    }
  }
  return entries;
}

function extractBody(req: Request): Buffer | undefined {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object") return Buffer.from(JSON.stringify(req.body));
  return undefined;
}

function toBuffer(payload: Buffer | string): Buffer {
  return Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
}
