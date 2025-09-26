import { describe, expect, it } from "vitest";

import { tokensFromResponse } from "../llm-openai";
import * as index from "../index";

describe("llm openai extras", () => {
  it("extracts token counts", () => {
    const usage = tokensFromResponse({ usage: { prompt_tokens: 12, completion_tokens: 34 } });
    expect(usage).toEqual({ promptTokens: 12, completionTokens: 34 });
  });

  it("handles missing usage", () => {
    const usage = tokensFromResponse({});
    expect(usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("re-exports from index", () => {
    expect(index.tokensFromResponse).toBe(tokensFromResponse);
  });
});
