"""Tribute core SDK for Python frameworks.

This package centralises canonicalization, pricing, usage accounting, and OpenAPI metadata helpers. Framework adapters import from here to avoid duplicating logic.
"""

from .canonicalization import CanonicalBody, CanonicalRequest, canonicalize_request
from .decorators import (
    MethodSemantics,
    cacheable,
    entitlement,
    estimate_handler,
    metered,
    resolve_semantics,
)
from .estimate import EstimateResult, HMACSigner, JWKSManager, Signer, estimate, verify_signature
from .openapi import ProxyMetadata, apply_openapi_extensions, build_proxy_metadata
from .policy import PolicyContext, PolicyDigest, compute_policy_digest
from .usage import UsageReport, UsageTracker, enrich_response, wrap_iterable

__all__ = [
    "CanonicalBody",
    "CanonicalRequest",
    "canonicalize_request",
    "cacheable",
    "entitlement",
    "EstimateResult",
    "estimate",
    "HMACSigner",
    "JWKSManager",
    "MethodSemantics",
    "estimate_handler",
    "PolicyContext",
    "PolicyDigest",
    "ProxyMetadata",
    "apply_openapi_extensions",
    "build_proxy_metadata",
    "UsageReport",
    "UsageTracker",
    "Signer",
    "compute_policy_digest",
    "enrich_response",
    "metered",
    "resolve_semantics",
    "verify_signature",
    "wrap_iterable",
]
