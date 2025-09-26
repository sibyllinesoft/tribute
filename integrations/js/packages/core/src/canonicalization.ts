import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

export type HeaderItems = Iterable<[string, string]>;
export type QueryItems = Iterable<[string, string]>;

export class CanonicalBody {
  constructor(
    public readonly raw: Buffer,
    public readonly digest: string,
    public readonly contentType?: string,
  ) {}

  asText(): string {
    try {
      return this.raw.toString("utf8");
    } catch {
      return this.raw.toString("hex");
    }
  }
}

export class CanonicalRequest {
  constructor(
    public readonly method: string,
    public readonly pathTemplate: string,
    public readonly headers: Record<string, string[]>,
    public readonly query: Record<string, string[]>,
    public readonly body?: CanonicalBody,
  ) {}

  hash(): string {
    const sha = createHash("sha256");
    sha.update(this.method);
    sha.update("\0");
    sha.update(this.pathTemplate);
    sha.update("\0");
    for (const [header, values] of Object.entries(this.headers)) {
      sha.update(header);
      sha.update("=");
      for (const value of values) {
        sha.update(value);
        sha.update("\0");
      }
    }
    sha.update("\0");
    for (const [key, values] of Object.entries(this.query)) {
      sha.update(key);
      sha.update("=");
      for (const value of values) {
        sha.update(value);
        sha.update("\0");
      }
    }
    if (this.body) {
      sha.update("\0");
      sha.update(this.body.digest);
    }
    return sha.digest("hex");
  }
}

export interface CanonicalizeRequestOptions {
  method: string;
  rawPath: string;
  headerAllowlist: string[];
  headers: HeaderItems;
  query: QueryItems;
  body?: Buffer;
  pathParams?: Record<string, unknown>;
}

export function canonicalizeRequest(options: CanonicalizeRequestOptions): CanonicalRequest {
  const headers = normalizeHeaders(options.headers, options.headerAllowlist);
  const query = normalizeQuery(options.query);
  const pathTemplate = applyPathParams(options.rawPath, options.pathParams);
  const contentType = headers["content-type"]?.[0];
  const body = options.body ? canonicalizeBody(options.body, contentType) : undefined;

  return new CanonicalRequest(
    options.method.toUpperCase(),
    pathTemplate,
    headers,
    query,
    body,
  );
}

function normalizeHeaders(headers: HeaderItems, allowlist: string[]): Record<string, string[]> {
  const allowset = new Set(allowlist.map((value) => value.toLowerCase()));
  const collected = new Map<string, string[]>();
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    if (!allowset.has(key)) continue;
    const bucket = collected.get(key) ?? [];
    bucket.push(String(value));
    collected.set(key, bucket);
  }
  return Object.fromEntries(
    [...collected.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, values]) => [key, [...values].sort()]),
  );
}

function normalizeQuery(query: QueryItems): Record<string, string[]> {
  const collected = new Map<string, string[]>();
  for (const [key, value] of query) {
    const bucket = collected.get(String(key)) ?? [];
    bucket.push(String(value));
    collected.set(String(key), bucket);
  }
  return Object.fromEntries(
    [...collected.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, values]) => [key, [...values].sort()]),
  );
}

function applyPathParams(rawPath: string, pathParams?: Record<string, unknown>): string {
  if (!pathParams) return rawPath;
  let template = rawPath;
  for (const [key, value] of Object.entries(pathParams)) {
    const placeholder = `{${key}}`;
    const segment = String(value);
    template = template.replace(`/${segment}`, `/${placeholder}`);
  }
  return template;
}

function canonicalizeBody(body: Buffer, contentType?: string): CanonicalBody {
  let payload = body;
  if (contentType && contentType.includes("json")) {
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      payload = Buffer.from(stableStringify(parsed));
    } catch {
      // fall back to raw body when parsing fails
    }
  }
  const digest = createHash("sha256").update(payload).digest("hex");
  return new CanonicalBody(payload, digest, contentType);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value instanceof Buffer) {
    return JSON.stringify(value.toString("base64"));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
