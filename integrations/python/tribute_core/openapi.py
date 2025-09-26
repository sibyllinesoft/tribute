"""Helpers for emitting x-proxy OpenAPI extensions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from .decorators import MethodSemantics


@dataclass
class ProxyMetadata:
    """Representation of the OpenAPI extensions Tribute expects."""

    x_proxy: Dict[str, Any]

    def to_extension(self) -> Dict[str, Any]:
        return {"x-proxy": self.x_proxy}


def build_proxy_metadata(semantics: MethodSemantics) -> ProxyMetadata:
    return ProxyMetadata(x_proxy=semantics.as_extension())


def apply_openapi_extensions(
    *,
    openapi_doc: Dict[str, Any],
    path: str,
    method: str,
    metadata: ProxyMetadata,
) -> Dict[str, Any]:
    """Merge the proxy metadata into an OpenAPI document in place."""

    if not metadata.x_proxy:
        return openapi_doc

    operation = (
        openapi_doc.setdefault("paths", {})
        .setdefault(path, {})
        .setdefault(method.lower(), {})
    )
    operation.setdefault("x-proxy", {}).update(metadata.x_proxy)
    return openapi_doc
