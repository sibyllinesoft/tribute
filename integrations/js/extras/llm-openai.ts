export function tokensFromResponse(response: { usage?: Record<string, unknown> }) {
  const usage = response.usage ?? {};
  return {
    promptTokens: Number(usage["prompt_tokens"] ?? 0),
    completionTokens: Number(usage["completion_tokens"] ?? 0),
  };
}
