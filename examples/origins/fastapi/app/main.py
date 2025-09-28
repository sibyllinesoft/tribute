from __future__ import annotations

import os
import time
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, Response

API_KEY = os.getenv("TRIBUTE_API_KEY", "local-dev-secret")
DEFAULT_PRICE = float(os.getenv("TRIBUTE_PRICE", "0.05"))
DEFAULT_ESTIMATE = float(os.getenv("TRIBUTE_ESTIMATE", "0.05"))
ROOT_PATH = os.getenv("TRIBUTE_ROOT_PATH", "")

app = FastAPI(title="Tribute FastAPI Example", version="0.1.0", root_path=ROOT_PATH)


def require_api_key(x_api_key: Annotated[str | None, Header()] = None) -> None:
    """Reject requests that don't present the expected API key."""
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok", "ts": str(int(time.time()))}


@app.get("/v1/demo", dependencies=[Depends(require_api_key)])
def demo() -> JSONResponse:
    payload = {
        "result": "Hello from FastAPI",
        "final_price": DEFAULT_PRICE,
        "currency": "USD",
        "usage": {
            "prompt_tokens": 32,
            "completion_tokens": 16,
        },
        "price_sig": None,
    }
    return JSONResponse(payload)


@app.get("/v1/demo/estimate", dependencies=[Depends(require_api_key)])
def demo_estimate() -> JSONResponse:
    payload = {
        "estimated_price": DEFAULT_ESTIMATE,
        "currency": "USD",
        "estimate_is_final": False,
        "estimate_ttl_seconds": 60,
        "policy_ver": 1,
        "policy_digest": "dev-policy",
        "price_sig": None,
    }
    return JSONResponse(payload)


@app.post("/v1/echo", dependencies=[Depends(require_api_key)])
def echo(body: dict[str, object] | None = None) -> JSONResponse:
    payload = {
        "echo": body or {},
        "final_price": DEFAULT_PRICE,
        "currency": "USD",
        "usage": {"input_bytes": float(len(str(body or {})))},
        "price_sig": None,
    }
    return JSONResponse(payload)


@app.post("/v1/echo/estimate", dependencies=[Depends(require_api_key)])
def echo_estimate() -> JSONResponse:
    payload = {
        "estimated_price": DEFAULT_ESTIMATE,
        "currency": "USD",
        "estimate_is_final": False,
        "estimate_ttl_seconds": 60,
        "policy_ver": 1,
        "policy_digest": "dev-policy",
        "price_sig": None,
    }
    return JSONResponse(payload)


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap() -> Response:
    body = """<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">
  <url>
    <loc>http://localhost:9000/</loc>
  </url>
  <url>
    <loc>http://localhost:9000/docs</loc>
  </url>
  <url>
    <loc>http://localhost:9000/v1/demo</loc>
  </url>
</urlset>"""
    return Response(content=body, media_type="application/xml")
