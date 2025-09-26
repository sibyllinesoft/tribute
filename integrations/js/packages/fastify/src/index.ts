import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify";
import {
  buildProxyMetadata,
  canonicalizeRequest,
  estimateHandler,
  resolveSemantics,
  UsageTracker,
} from "@tribute/core";

const DEFAULT_HEADER_ALLOWLIST = ["authorization", "content-type", "accept"];

export function registerMeterxRoute(
  instance: FastifyInstance,
  path: string,
  handler: any,
  options: RouteShorthandOptions = {},
) {
  const semantics = resolveSemantics(handler);

  instance.route({
    url: path,
    method: options.method ?? ["GET", "POST", "PUT", "PATCH", "DELETE"],
    ...options,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const tracker = new UsageTracker();
      const canonical = canonicalizeRequest({
        method: request.method,
        rawPath: request.routerPath || request.url,
        headerAllowlist: DEFAULT_HEADER_ALLOWLIST,
        headers: iterateHeaders(request.headers as Record<string, any>),
        query: iterateQuery(request.query as Record<string, any>),
        body: extractBody(request.body),
        pathParams: request.params as Record<string, unknown>,
      });
      (request as any).tributeCanonical = canonical;
      const result = await handler(request, reply, tracker);
      if (reply.sent) return result;
      if (result && typeof result === "object" && (result as any).body) {
        tracker.addChunk(toBuffer((result as any).body));
        if ((result as any).usage) tracker.setUsage((result as any).usage);
        if ((result as any).finalPrice !== undefined) tracker.setFinalPrice((result as any).finalPrice);
        reply.header("x-tribute-usage", JSON.stringify(tracker.build()));
        reply.send((result as any).body);
        return undefined;
      }
      return result;
    },
  });

  const estimator = estimateHandler(handler);
  if (estimator) {
    instance.post(`${path}/estimate`, async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await estimator(request, reply);
      reply.send(result);
    });
  }
}

export function proxyExtensions(handler: any) {
  return buildProxyMetadata(resolveSemantics(handler));
}

function iterateHeaders(headers: Record<string, any>) {
  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) entries.push([name, String(entry)]);
    } else if (value !== undefined) {
      entries.push([name, String(value)]);
    }
  }
  return entries;
}

function iterateQuery(query: Record<string, any>) {
  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) entries.push([name, String(entry)]);
    } else if (value !== undefined) {
      entries.push([name, String(value)]);
    }
  }
  return entries;
}

function extractBody(body: unknown): Buffer | undefined {
  if (!body) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.from(JSON.stringify(body));
}

function toBuffer(payload: Buffer | string): Buffer {
  return Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
}
