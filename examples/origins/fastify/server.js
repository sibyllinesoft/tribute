import Fastify from "fastify";

const API_KEY = process.env.TRIBUTE_API_KEY ?? "local-dev-secret";
const DEFAULT_PRICE = Number(process.env.TRIBUTE_PRICE ?? "0.05");
const DEFAULT_ESTIMATE = Number(process.env.TRIBUTE_ESTIMATE ?? "0.05");
const PORT = Number(process.env.PORT ?? "3000");

const fastify = Fastify({ logger: true });

fastify.addHook("onRequest", async (request, reply) => {
  if (request.url === "/healthz") {
    return;
  }
  const apiKey = request.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

fastify.get("/healthz", async () => ({ status: "ok", ts: Date.now() }));

fastify.get("/v1/demo", async () => ({
  result: "Hello from Fastify",
  final_price: DEFAULT_PRICE,
  currency: "USD",
  usage: {
    prompt_tokens: 24,
    completion_tokens: 12,
  },
  price_sig: null,
}));

fastify.get("/v1/demo/estimate", async () => ({
  estimated_price: DEFAULT_ESTIMATE,
  currency: "USD",
  estimate_is_final: false,
  estimate_ttl_seconds: 60,
  policy_ver: 1,
  policy_digest: "dev-policy",
  price_sig: null,
}));

fastify.post("/v1/echo", async (request) => ({
  echo: request.body ?? null,
  final_price: DEFAULT_PRICE,
  currency: "USD",
  usage: { input_bytes: JSON.stringify(request.body ?? "").length },
  price_sig: null,
}));

const start = async () => {
  try {
    await fastify.listen({ host: "0.0.0.0", port: PORT });
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

start();
