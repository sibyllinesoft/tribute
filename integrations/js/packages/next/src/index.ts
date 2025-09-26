import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import {
  buildProxyMetadata,
  canonicalizeRequest,
  estimateHandler,
  resolveSemantics,
} from "@tribute/core";

const DEFAULT_HEADER_ALLOWLIST = ["authorization", "content-type", "accept"];

export function withMeterx(handler: NextApiHandler): NextApiHandler {
  resolveSemantics(handler);

  const wrapped: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const canonical = canonicalizeRequest({
      method: req.method || "GET",
      rawPath: req.url || "",
      headerAllowlist: DEFAULT_HEADER_ALLOWLIST,
      headers: iterateHeaders(req.headers),
      query: iterateQuery(req.query),
      body: extractBody(req.body),
      pathParams: {},
    });
    (req as any).tributeCanonical = canonical;
    return handler(req, res);
  };

  (wrapped as any).estimate = estimateHandler(handler);
  return wrapped;
}

export function createEstimateHandler(handler: NextApiHandler): NextApiHandler | undefined {
  return estimateHandler(handler) as NextApiHandler | undefined;
}

export function proxyExtensions(handler: NextApiHandler) {
  return buildProxyMetadata(resolveSemantics(handler));
}

function iterateHeaders(headers: NextApiRequest["headers"]) {
  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) entries.push([name, entry ?? ""]);
    } else if (value !== undefined) {
      entries.push([name, String(value)]);
    }
  }
  return entries;
}

function iterateQuery(query: NextApiRequest["query"]) {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const entry of value) entries.push([key, entry]);
    } else {
      entries.push([key, value ?? ""]);
    }
  }
  return entries;
}

function extractBody(body: NextApiRequest["body"]): Buffer | undefined {
  if (!body) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.from(JSON.stringify(body));
}
