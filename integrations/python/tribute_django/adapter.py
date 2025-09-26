"""Django REST Framework integration skeleton."""

from __future__ import annotations

from typing import Any, Callable

from tribute_core import canonicalize_request, estimate_handler, resolve_semantics


class DRFAdapter:
    """Wrap DRF viewsets to invoke Tribute core hooks."""

    def __init__(self, *, router: Any, header_allowlist: list[str] | None = None):
        self.router = router
        self.header_allowlist = header_allowlist or ["authorization", "content-type", "accept"]

    def register_viewset(self, path: str, viewset: Any, *, basename: str) -> None:
        self.router.register(path, viewset, basename=basename)

        for method in getattr(viewset, "http_method_names", []):
            handler = getattr(viewset, method, None)
            if not handler:
                continue
            semantics = resolve_semantics(handler)
            wrapped = self._instrument_method(handler)
            setattr(viewset, method, wrapped)
            estimator = estimate_handler(handler)
            if estimator:
                setattr(viewset, f"{method}_estimate", estimator)

    def _instrument_method(self, handler: Callable[..., Any]) -> Callable[..., Any]:
        header_allowlist = self.header_allowlist

        def wrapped(viewset_self: Any, request: Any, *args: Any, **kwargs: Any):
            canonical = canonicalize_request(
                method=request.method,
                raw_path=request.get_full_path(),
                header_allowlist=header_allowlist,
                headers=request.headers.items(),
                query=request.query_params.lists() if hasattr(request.query_params, "lists") else request.query_params.items(),
                body=request.body,
                path_params=kwargs,
            )
            setattr(request, "tribute_canonical", canonical)
            return handler(viewset_self, request, *args, **kwargs)

        return wrapped
