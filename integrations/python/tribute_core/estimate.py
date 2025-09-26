"""Estimate pipeline helpers: price construction, signing, and verification."""

from __future__ import annotations

import base64
import hmac
import json
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from typing import Any, Callable, Dict, Mapping, Optional, Protocol


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


@dataclass
class EstimateResult:
    """Normalized estimate payload returned to integrators."""

    estimated_price: Decimal
    observables: Mapping[str, Any]
    price_signature: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "estimated_price": str(self.estimated_price.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)),
            "observables": self.observables,
        }
        if self.price_signature:
            payload["price_signature"] = self.price_signature
        return payload


class Signer(Protocol):
    key_id: str

    def sign_estimate(self, price: Decimal, observables: Mapping[str, Any]) -> str:
        ...


class HMACSigner:
    """JWS HS256 signer for price estimates (suitable for PoC usage)."""

    def __init__(self, *, key_id: str, secret: bytes):
        self.key_id = key_id
        self._secret = secret

    def sign_estimate(self, price: Decimal, observables: Mapping[str, Any]) -> str:
        header = {"alg": "HS256", "kid": self.key_id, "typ": "JOSE"}
        payload = {
            "price": str(price),
            "observables": observables,
        }
        encoded_header = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        encoded_payload = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        digest = hmac.new(self._secret, signing_input, sha256).digest()
        encoded_signature = _b64url(digest)
        return f"{encoded_header}.{encoded_payload}.{encoded_signature}"

    @property
    def secret(self) -> bytes:
        return self._secret


class JWKSManager:
    """In-memory JWKS manager for rotating signing keys."""

    def __init__(self):
        self._signers: Dict[str, HMACSigner] = {}

    def register(self, signer: HMACSigner) -> None:
        self._signers[signer.key_id] = signer

    def resolve(self, key_id: str) -> Optional[HMACSigner]:
        return self._signers.get(key_id)

    def jwks(self) -> Dict[str, Any]:
        return {
            "keys": [
                {
                    "kid": signer.key_id,
                    "kty": "oct",
                    "alg": "HS256",
                }
                for signer in self._signers.values()
            ]
        }


def estimate(
    *,
    estimated_price: Decimal,
    observables: Optional[Mapping[str, Any]] = None,
    signer: Optional[Signer] = None,
) -> EstimateResult:
    """Construct an estimate response and optionally sign it."""

    observables = observables or {}
    signature = signer.sign_estimate(estimated_price, observables) if signer else None
    return EstimateResult(
        estimated_price=estimated_price,
        observables=dict(observables),
        price_signature=signature,
    )


def verify_signature(
    *,
    token: str,
    key_resolver: Callable[[str], Optional[bytes]],
) -> bool:
    """Validate an HS256 signature and return True when it matches."""

    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
    except ValueError:
        return False

    try:
        header = json.loads(base64.urlsafe_b64decode(_pad_b64(encoded_header)))
    except json.JSONDecodeError:
        return False

    kid = header.get("kid")
    if not kid:
        return False

    secret = key_resolver(str(kid))
    if secret is None:
        return False

    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    expected = hmac.new(secret, signing_input, sha256).digest()
    provided = base64.urlsafe_b64decode(_pad_b64(encoded_signature))
    return hmac.compare_digest(expected, provided)


def _pad_b64(segment: str) -> bytes:
    padding = "=" * ((4 - len(segment) % 4) % 4)
    return (segment + padding).encode("ascii")
