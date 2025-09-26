"""Utilities for extracting usage metrics from OpenAI responses."""

from __future__ import annotations

from typing import Any, Dict, Mapping


def tokens_from_response(response: Mapping[str, Any]) -> Dict[str, int]:
    """Return prompt/completion token counts from a ChatCompletion response."""

    usage = response.get("usage") or {}
    return {
        "prompt_tokens": int(usage.get("prompt_tokens", 0)),
        "completion_tokens": int(usage.get("completion_tokens", 0)),
    }
