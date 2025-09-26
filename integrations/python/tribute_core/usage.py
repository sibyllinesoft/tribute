"""Usage accounting helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, MutableMapping, Optional, Tuple


@dataclass
class UsageReport:
    """Structured usage emitted back to the proxy."""

    final_price: Optional[float]
    usage: Mapping[str, Any]
    response_bytes: int


class UsageTracker:
    """Collect byte counts and structured usage for responses."""

    def __init__(self) -> None:
        self._bytes = 0
        self._usage: MutableMapping[str, Any] = {}
        self._final_price: Optional[float] = None

    def add_chunk(self, chunk: bytes) -> None:
        self._bytes += len(chunk)

    def set_usage(self, usage: Mapping[str, Any]) -> None:
        self._usage.update(dict(usage))

    def set_final_price(self, price: Optional[float]) -> None:
        self._final_price = price

    def build(self) -> UsageReport:
        return UsageReport(
            final_price=self._final_price,
            usage=dict(self._usage),
            response_bytes=self._bytes,
        )


def enrich_response(
    *,
    body: bytes,
    usage: Optional[Mapping[str, Any]] = None,
    final_price: Optional[float] = None,
) -> Tuple[bytes, UsageReport]:
    """Attach usage metadata to a response body."""

    tracker = UsageTracker()
    tracker.add_chunk(body)
    if usage:
        tracker.set_usage(usage)
    tracker.set_final_price(final_price)
    return body, tracker.build()


def wrap_iterable(
    iterable: Iterable[bytes], *, tracker: Optional[UsageTracker] = None
) -> Iterable[bytes]:
    """Yield body chunks while counting bytes."""

    tracker = tracker or UsageTracker()
    for chunk in iterable:
        tracker.add_chunk(chunk)
        yield chunk
