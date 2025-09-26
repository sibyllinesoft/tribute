"""Developer tooling: CLI utilities for validation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable

from .estimate import verify_signature


def diff_openapi(previous: Path, current: Path) -> Dict[str, Any]:
    """Return a diff skeleton between two OpenAPI documents."""

    before = json.loads(previous.read_text()) if previous.exists() else {}
    after = json.loads(current.read_text()) if current.exists() else {}
    return {
        "added_paths": sorted(set(after.get("paths", {})) - set(before.get("paths", {}))),
        "removed_paths": sorted(set(before.get("paths", {})) - set(after.get("paths", {}))),
    }


def verify_signature_cli(payload: Path, jwk_path: Path) -> bool:
    data = json.loads(payload.read_text())
    jwk = json.loads(jwk_path.read_text())
    token = data.get("price_signature")
    if not token:
        raise ValueError("payload missing price_signature")

    def resolver(kid: str) -> bytes | None:
        for key in jwk.get("keys", []):
            if key.get("kid") == kid:
                secret = key.get("k")
                if not secret:
                    return None
                return secret.encode("utf-8")
        return None

    return verify_signature(token=token, key_resolver=resolver)


def _simulate_receipt() -> Dict[str, Any]:
    return {
        "status": "ok",
        "message": "simulation placeholder",
    }


def run(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tribute-dev", description="Tribute integration utilities")
    sub = parser.add_subparsers(dest="command")

    diff_cmd = sub.add_parser("diff-openapi", help="compare two OpenAPI specs")
    diff_cmd.add_argument("previous", type=Path)
    diff_cmd.add_argument("current", type=Path)

    verify_cmd = sub.add_parser("verify-estimate", help="validate a price signature against a JWKS")
    verify_cmd.add_argument("payload", type=Path)
    verify_cmd.add_argument("jwks", type=Path)

    sub.add_parser("simulate-receipt", help="run a proxy receipt simulation")

    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.command == "diff-openapi":
        result = diff_openapi(args.previous, args.current)
        print(json.dumps(result, indent=2))
        return 0
    if args.command == "verify-estimate":
        ok = verify_signature_cli(args.payload, args.jwks)
        print("valid" if ok else "invalid")
        return 0 if ok else 1
    if args.command == "simulate-receipt":
        print(json.dumps(_simulate_receipt(), indent=2))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(run())
