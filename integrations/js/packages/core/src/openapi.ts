import { MethodSemantics } from "./decorators";

export interface ProxyMetadata {
  xProxy: Record<string, unknown>;
}

export function buildProxyMetadata(semantics: MethodSemantics): ProxyMetadata {
  const extension: Record<string, unknown> = {};
  if (semantics.metered) extension.metered = semantics.metered;
  if (semantics.entitlement) extension.entitlement = semantics.entitlement;
  if (semantics.cacheable) extension.cacheable = semantics.cacheable;
  if (semantics.estimateHandler) extension.estimate = { available: true };
  return { xProxy: extension };
}

export function applyOpenapiExtensions(params: {
  document: Record<string, any>;
  path: string;
  method: string;
  metadata: ProxyMetadata;
}) {
  const { document, path, method, metadata } = params;
  if (!metadata.xProxy || Object.keys(metadata.xProxy).length === 0) return document;
  const paths = document.paths ?? (document.paths = {});
  const operation = paths[path] ?? (paths[path] = {});
  const entry = operation[method.toLowerCase()] ?? (operation[method.toLowerCase()] = {});
  entry["x-proxy"] = {
    ...(entry["x-proxy"] ?? {}),
    ...metadata.xProxy,
  };
  return document;
}
