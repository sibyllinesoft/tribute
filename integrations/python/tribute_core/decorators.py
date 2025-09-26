"""Declarative decorators that annotate route semantics.

Decorators attach metadata to handlers while keeping them pure functions. The
metadata lives on ``__tribute_semantics__`` so adapters can discover it without
executing the user handler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import wraps
from typing import Any, Callable, Dict, Optional, Protocol, TypeVar, cast

F = TypeVar("F", bound=Callable[..., Any])


@dataclass
class MethodSemantics:
    """Metadata collected by the decorators for downstream use."""

    metered: Dict[str, Any] = field(default_factory=dict)
    entitlement: Optional[Dict[str, Any]] = None
    cacheable: Optional[Dict[str, Any]] = None
    estimate_handler: Optional[Callable[..., Any]] = None

    def as_extension(self) -> Dict[str, Any]:
        """Return the OpenAPI `x-proxy` extension content."""

        extension: Dict[str, Any] = {}
        if self.metered:
            extension["metered"] = self.metered
        if self.entitlement:
            extension["entitlement"] = self.entitlement
        if self.cacheable:
            extension["cacheable"] = self.cacheable
        if self.estimate_handler:
            extension["estimate"] = {"available": True}
        return extension


def _ensure_semantics(target: Callable[..., Any]) -> MethodSemantics:
    semantics = getattr(target, "__tribute_semantics__", None)
    if semantics is None:
        semantics = MethodSemantics()
        setattr(target, "__tribute_semantics__", semantics)
    return cast(MethodSemantics, semantics)


def _wrap_handler(func: F, semantics: MethodSemantics) -> F:
    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any):
        return func(*args, **kwargs)

    setattr(wrapper, "__tribute_semantics__", semantics)

    def register_estimate(estimator: Callable[..., Any]) -> Callable[..., Any]:
        semantics.estimate_handler = estimator
        return estimator

    setattr(wrapper, "estimate", register_estimate)
    return cast(F, wrapper)


def metered(**options: Any) -> Callable[[F], F]:
    """Mark a handler as metered and store pricing semantics."""

    def decorator(func: F) -> F:
        semantics = _ensure_semantics(func)
        semantics.metered = {**options}
        return _wrap_handler(func, semantics)

    return decorator


def entitlement(**options: Any) -> Callable[[F], F]:
    """Declare entitlement metadata for enforcement and documentation."""

    def decorator(func: F) -> F:
        semantics = _ensure_semantics(func)
        semantics.entitlement = {**options}
        return _wrap_handler(func, semantics)

    return decorator


def cacheable(**options: Any) -> Callable[[F], F]:
    """Annotate cache semantics for the proxy's guidance."""

    def decorator(func: F) -> F:
        semantics = _ensure_semantics(func)
        semantics.cacheable = {**options}
        return _wrap_handler(func, semantics)

    return decorator


def resolve_semantics(handler: Callable[..., Any]) -> MethodSemantics:
    """Return decorator metadata for a handler."""

    return _ensure_semantics(handler)


def estimate_handler(handler: Callable[..., Any]) -> Optional[Callable[..., Any]]:
    """Return the registered estimate handler for a decorated function."""

    semantics = resolve_semantics(handler)
    return semantics.estimate_handler
