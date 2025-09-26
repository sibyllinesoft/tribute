"""Flask integration for Tribute core hooks."""

from __future__ import annotations

from typing import Any, Callable, Iterable, List, Tuple

from tribute_core import canonicalize_request, estimate_handler, resolve_semantics

HeaderItems = Iterable[Tuple[str, str]]
QueryItems = Iterable[Tuple[str, str]]


class FlaskAdapter:
    """Wrap Flask app routes to tap into Tribute core semantics."""

    def __init__(self, app: Any, *, header_allowlist: List[str] | None = None):
        self.app = app
        self.header_allowlist = header_allowlist or ["authorization", "content-type", "accept"]

    def register(
        self,
        rule: str,
        *,
        handler: Callable[..., Any],
        methods: Iterable[str] = ("GET",),
        endpoint: str | None = None,
    ) -> None:
        semantics = resolve_semantics(handler)
        endpoint = endpoint or handler.__name__

        def wrapped(*args: Any, **kwargs: Any):
            from flask import request as flask_request  # deferred import

            canonical = canonicalize_request(
                method=flask_request.method,
                raw_path=flask_request.path,
                header_allowlist=self.header_allowlist,
                headers=_iter_headers(flask_request.headers),
                query=_iter_query(flask_request.args),
                body=flask_request.get_data(),
                path_params=kwargs,
            )
            flask_request.environ["tribute.canonical_request"] = canonical
            return handler(*args, **kwargs)

        self.app.add_url_rule(rule, endpoint, wrapped, methods=list(methods))

        estimator = estimate_handler(handler)
        if estimator:
            self.app.add_url_rule(
                f"{rule}/estimate",
                f"{endpoint}_estimate",
                estimator,
                methods=["POST"],
            )


def _iter_headers(headers: Any) -> HeaderItems:
    if hasattr(headers, "items"):
        return headers.items(multi=True)
    return headers


def _iter_query(args: Any) -> QueryItems:
    if hasattr(args, "lists"):
        for key, values in args.lists():
            for value in values:
                yield key, value
    else:
        for key, value in args.items():
            yield key, value
