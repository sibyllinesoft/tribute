"""FastAPI adapter that wires handlers into the Tribute core."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Iterable, Optional

from tribute_core import (
    apply_openapi_extensions,
    build_proxy_metadata,
    canonicalize_request,
    estimate_handler,
    resolve_semantics,
)

HeaderItems = Iterable[tuple[str, str]]
QueryItems = Iterable[tuple[str, str]]


class FastAPIAdapter:
    """Attach Tribute semantics to FastAPI routes."""

    def __init__(self, *, app: Any, header_allowlist: Optional[list[str]] = None):
        self.app = app
        self.header_allowlist = header_allowlist or ["authorization", "content-type", "accept"]

    def register(
        self,
        path: str,
        *,
        handler: Callable[..., Any],
        methods: Optional[list[str]] = None,
        name: Optional[str] = None,
    ) -> None:
        semantics = resolve_semantics(handler)
        self.app.add_api_route(
            path,
            handler,
            methods=methods,
            name=name,
        )
        estimator = estimate_handler(handler)
        if estimator:
            self.app.add_api_route(
                f"{path}/estimate",
                estimator,
                methods=["POST"],
                name=f"{name or handler.__name__}_estimate",
            )

    async def on_request(self, request: Any):
        body = await request.body() if callable(getattr(request, "body", None)) else None
        canonical = canonicalize_request(
            method=request.method,
            raw_path=str(request.url.path),
            header_allowlist=self.header_allowlist,
            headers=_iter_headers(request.headers),
            query=_iter_query(request.query_params),
            body=body,
            path_params=request.path_params,
        )
        state = getattr(request, "state", None)
        if state is not None:
            setattr(state, "tribute_canonical", canonical)
        return canonical

    def patch_openapi(self) -> None:
        schema = self.app.openapi()
        for route in getattr(self.app, "routes", []):
            endpoint = getattr(route, "endpoint", None)
            path = getattr(route, "path", None)
            methods = getattr(route, "methods", None)
            if not endpoint or not path or not methods:
                continue
            semantics = resolve_semantics(endpoint)
            metadata = build_proxy_metadata(semantics)
            for method in methods:
                apply_openapi_extensions(
                    openapi_doc=schema,
                    path=path,
                    method=method,
                    metadata=metadata,
                )
        self.app.openapi_schema = schema


def _iter_headers(headers: Any) -> HeaderItems:
    if hasattr(headers, "multi_items"):
        return headers.multi_items()
    return headers.items()


def _iter_query(params: Any) -> QueryItems:
    if hasattr(params, "multi_items"):
        return params.multi_items()
    return params.items()
