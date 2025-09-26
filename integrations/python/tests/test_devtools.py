import json
from pathlib import Path

import pytest

from tribute_core import HMACSigner
from tribute_core.devtools import diff_openapi, run, verify_signature_cli


@pytest.fixture
def tmp_files(tmp_path: Path):
    previous = tmp_path / "before.json"
    current = tmp_path / "after.json"

    previous.write_text(json.dumps({"paths": {"/old": {}}}))
    current.write_text(json.dumps({"paths": {"/new": {}}}))
    return previous, current


def test_diff_openapi_reports_added_and_removed(tmp_files):
    previous, current = tmp_files
    diff = diff_openapi(previous, current)
    assert diff == {"added_paths": ["/new"], "removed_paths": ["/old"]}


def test_verify_signature_cli_roundtrip(tmp_path: Path):
    signer = HMACSigner(key_id="primary", secret=b"secret")
    token = signer.sign_estimate(price=1, observables={})

    payload = tmp_path / "payload.json"
    payload.write_text(json.dumps({"price_signature": token}))

    jwks = tmp_path / "jwks.json"
    jwks.write_text(json.dumps({"keys": [{"kid": "primary", "k": "secret"}]}))

    assert verify_signature_cli(payload, jwks) is True


def test_verify_signature_cli_missing_signature(tmp_path: Path):
    payload = tmp_path / "payload.json"
    payload.write_text(json.dumps({}))
    jwks = tmp_path / "jwks.json"
    jwks.write_text(json.dumps({"keys": []}))

    with pytest.raises(ValueError):
        verify_signature_cli(payload, jwks)


def test_run_simulate_receipt(capsys):
    exit_code = run(["simulate-receipt"])
    assert exit_code == 0
    assert "simulation placeholder" in capsys.readouterr().out


def test_run_diff_openapi(tmp_files, capsys):
    previous, current = tmp_files
    exit_code = run(["diff-openapi", str(previous), str(current)])
    assert exit_code == 0
    output = json.loads(capsys.readouterr().out)
    assert output["added_paths"] == ["/new"]


def test_run_verify_estimate(tmp_path: Path, capsys):
    signer = HMACSigner(key_id="cli", secret=b"secret")
    token = signer.sign_estimate(price=1, observables={})

    payload = tmp_path / "payload.json"
    payload.write_text(json.dumps({"price_signature": token}))
    jwks = tmp_path / "jwks.json"
    jwks.write_text(json.dumps({"keys": [{"kid": "cli", "k": "secret"}]}))

    exit_code = run(["verify-estimate", str(payload), str(jwks)])
    captured = capsys.readouterr()
    assert exit_code == 0
    assert "valid" in captured.out


def test_run_without_command_shows_help(capsys):
    exit_code = run([])
    assert exit_code == 1
    assert "Tribute integration utilities" in capsys.readouterr().out
