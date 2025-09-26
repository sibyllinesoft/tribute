"""Request canonicalization primitives shared across adapters.

The canonical form is shared across all framework adapters so pricing and policy
logic can operate on stable request inputs. Canonicalization follows these
rules:

1. Methods are upper-cased.
2. Dynamic path segments are rewritten to ``{param}`` placeholders.
3. Headers are filtered by an allowlist, folded to lowercase, and value-sorted.
4. Query parameters are sorted first by key, then value.
5. Bodies are normalised — JSON payloads are re-serialised with sorted keys.
6. A SHA-256 digest is computed for optional inclusion in receipts.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Iterable, Mapping, MutableMapping, Optional, Sequence, Tuple

HeaderItems = Iterable[Tuple[str, str]]
QueryItems = Iterable[Tuple[str, str]]


@dataclass(frozen=True)
class CanonicalBody:
    """Representation of a canonicalised request body."""

    raw: bytes
    digest: str
    content_type: Optional[str]

    def as_text(self) -> str:
        try:
            return self.raw.decode("utf-8")
        except UnicodeDecodeError:
            return self.raw.hex()


@dataclass(frozen=True)
class CanonicalRequest:
    """Canonical representation of an inbound request."""

    method: str
    path_template: str
    headers: Mapping[str, Tuple[str, ...]]
    query: Mapping[str, Tuple[str, ...]]
    body: Optional[CanonicalBody]

    def hash(self) -> str:
        """Return a stable digest of the canonical representation."""

        sha = hashlib.sha256()
        sha.update(self.method.encode("utf-8"))
        sha.update(b"\0")
        sha.update(self.path_template.encode("utf-8"))
        sha.update(b"\0")
        for header, values in self.headers.items():
            sha.update(header.encode("utf-8"))
            sha.update(b"=")
            for value in values:
                sha.update(value.encode("utf-8"))
                sha.update(b"\0")
        sha.update(b"\0")
        for key, values in self.query.items():
            sha.update(key.encode("utf-8"))
            sha.update(b"=")
            for value in values:
                sha.update(value.encode("utf-8"))
                sha.update(b"\0")
        if self.body:
            sha.update(b"\0")
            sha.update(self.body.digest.encode("utf-8"))
        return sha.hexdigest()


def canonicalize_request(
    *,
    method: str,
    raw_path: str,
    header_allowlist: Sequence[str],
    headers: HeaderItems,
    query: QueryItems,
    body: Optional[bytes],
    path_params: Optional[Mapping[str, object]] = None,
) -> CanonicalRequest:
    """Normalise request primitives into a canonical shape."""

    normalized_headers = _normalize_headers(headers, header_allowlist)
    normalized_query = _normalize_query(query)

    path_template = _apply_path_params(raw_path, path_params)

    content_type = normalized_headers.get("content-type", (None,))[0]
    canonical_body = _canonicalize_body(body, content_type) if body else None

    return CanonicalRequest(
        method=method.upper(),
        path_template=path_template,
        headers=normalized_headers,
        query=normalized_query,
        body=canonical_body,
    )


def _normalize_headers(
    headers: HeaderItems, allowlist: Sequence[str]
) -> Mapping[str, Tuple[str, ...]]:
    allowset = {value.lower() for value in allowlist}
    collected: MutableMapping[str, list[str]] = {}
    for name, value in headers:
        key = name.lower()
        if key not in allowset:
            continue
        collected.setdefault(key, []).append(str(value))
    # Deterministic ordering
    return {key: tuple(sorted(values)) for key, values in sorted(collected.items())}


def _normalize_query(query: QueryItems) -> Mapping[str, Tuple[str, ...]]:
    collected: MutableMapping[str, list[str]] = {}
    for key, value in query:
        collected.setdefault(str(key), []).append(str(value))
    return {
        key: tuple(sorted(values))
        for key, values in sorted(collected.items(), key=lambda item: item[0])
    }


def _apply_path_params(
    raw_path: str, path_params: Optional[Mapping[str, object]]
) -> str:
    if not path_params:
        return raw_path
    template = raw_path
    for key, value in path_params.items():
        # Only replace exact path segments
        placeholder = f"{{{key}}}"
        segment = str(value)
        template = template.replace(f"/{segment}", f"/{placeholder}")
    return template


def _canonicalize_body(
    body: bytes, content_type: Optional[str]
) -> CanonicalBody:
    payload = body
    if content_type and "json" in content_type:
        try:
            loaded = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            loaded = None
        if loaded is not None:
            payload = json.dumps(loaded, separators=(",", ":"), sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    return CanonicalBody(raw=payload, digest=digest, content_type=content_type)
