import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Buffer } from "node:buffer";
import { Observable } from "rxjs";
import { buildProxyMetadata, canonicalizeRequest, resolveSemantics } from "@tribute/core";

const DEFAULT_HEADER_ALLOWLIST = ["authorization", "content-type", "accept"];

export class MeterxInterceptor implements NestInterceptor {
  constructor(private readonly headerAllowlist = DEFAULT_HEADER_ALLOWLIST) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const canonical = canonicalizeRequest({
      method: req.method,
      rawPath: req.url,
      headerAllowlist: this.headerAllowlist,
      headers: iterateHeaders(req.headers ?? {}),
      query: iterateQuery(req.query ?? {}),
      body: extractBody(req.rawBody ?? req.body),
      pathParams: req.params,
    });
    req.tributeCanonical = canonical;
    return next.handle();
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
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const entry of value) entries.push([key, String(entry)]);
    } else if (value !== undefined) {
      entries.push([key, String(value)]);
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
