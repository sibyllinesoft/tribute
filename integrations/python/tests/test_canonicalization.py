from tribute_core import canonicalize_request


def test_json_body_canonicalization():
    request = canonicalize_request(
        method="post",
        raw_path="/llm/123",
        header_allowlist=["content-type"],
        headers=[("Content-Type", "application/json"), ("X-Ignored", "ok")],
        query=[("b", "2"), ("a", "1")],
        body=b"{\n  \"beta\": 2, \n  \"alpha\": 1\n}",
        path_params={"chat_id": 123},
    )

    assert request.method == "POST"
    assert request.path_template == "/llm/{chat_id}"
    assert request.headers == {"content-type": ("application/json",)}
    assert request.query == {"a": ("1",), "b": ("2",)}
    assert request.body is not None
    assert request.body.as_text() == '{"alpha":1,"beta":2}'
    assert len(request.body.digest) == 64


def test_hash_changes_when_query_differs():
    first = canonicalize_request(
        method="get",
        raw_path="/foo",
        header_allowlist=[],
        headers=[],
        query=[("a", "1")],
        body=None,
    )
    second = canonicalize_request(
        method="get",
        raw_path="/foo",
        header_allowlist=[],
        headers=[],
        query=[("a", "2")],
        body=None,
    )

    assert first.hash() != second.hash()

def test_path_param_replacement(tmp_path):
    canonical = canonicalize_request(
        method="get",
        raw_path="/files/2024/report",
        header_allowlist=["accept"],
        headers=[("Accept", "application/json"), ("X-Ignore", "1")],
        query=[],
        body=None,
        path_params={"year": 2024},
    )
    assert canonical.path_template == "/files/{year}/report"
    assert canonical.headers == {"accept": ("application/json",)}


def test_canonical_body_binary_fallback():
    blob = b"\xff\xfe"
    canonical = canonicalize_request(
        method="post",
        raw_path="/binary",
        header_allowlist=[],
        headers=[],
        query=[],
        body=blob,
    )
    assert canonical.body is not None
    assert canonical.body.as_text() == blob.hex()


def test_canonicalize_body_invalid_json():
    canonical = canonicalize_request(
        method="post",
        raw_path="/broken",
        header_allowlist=["content-type"],
        headers=[("Content-Type", "application/json")],
        query=[],
        body=b"{not-json}",
    )
    assert canonical.body is not None
    # When parsing fails the raw payload is preserved
    assert canonical.body.raw == b"{not-json}"
