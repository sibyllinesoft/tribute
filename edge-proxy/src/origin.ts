import type { MerchantConfig } from "@tribute/durable-objects";
import type { ProxyEnv } from "./env";

export interface OriginRequestContext {
  url: URL;
  headers: Headers;
}

export const buildOriginRequest = async (
  request: Request,
  config: MerchantConfig,
  env: ProxyEnv,
  opts: { overridePath?: string } = {}
): Promise<OriginRequestContext> => {
  const originBase = new URL(config.origin.baseUrl);
  const incomingUrl = new URL(request.url);
  const effectivePath = opts.overridePath ?? incomingUrl.pathname;
  const mergedPath = joinPaths(originBase.pathname, effectivePath);
  originBase.pathname = mergedPath;
  originBase.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  await rewriteAuth(headers, config, env);

  return {
    url: originBase,
    headers,
  };
};

const rewriteAuth = async (headers: Headers, config: MerchantConfig, env: ProxyEnv) => {
  if (config.origin.auth.kind === "api_key") {
    const header = config.origin.auth.header ?? "x-api-key";
    const secret = await resolveSecret(config.origin.auth.secretRef, env);
    headers.set(header, secret);
    headers.delete("authorization");
  } else if (config.origin.auth.kind === "jwt") {
    const secret = await resolveSecret(config.origin.auth.secretRef, env);
    headers.set("authorization", `Bearer ${secret}`);
  }
};

const resolveSecret = async (ref: string, env: ProxyEnv): Promise<string> => {
  if (ref.startsWith("env:")) {
    const key = ref.slice(4);
    const value = (env as Record<string, string | undefined>)[key];
    if (!value) throw new Error(`secret_env_missing:${key}`);
    return value;
  }
  if (ref.startsWith("kv:")) {
    const key = ref.slice(3);
    if (!env.ORIGIN_SECRETS) throw new Error("origin_secrets_kv_missing");
    const secret = await env.ORIGIN_SECRETS.get(key);
    if (!secret) throw new Error(`secret_kv_missing:${key}`);
    return secret;
  }
  return ref;
};

const joinPaths = (base: string, extra: string): string => {
  if (!base.endsWith("/")) {
    base = base + "/";
  }
  if (extra.startsWith("/")) {
    extra = extra.slice(1);
  }
  return `${base}${extra}`;
};
