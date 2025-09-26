from tribute_core import MethodSemantics, apply_openapi_extensions, build_proxy_metadata


def test_apply_openapi_extensions_merges_metadata():
    semantics = MethodSemantics(
        metered={"policy_ver": 2},
        entitlement={"feature": "pro"},
    )
    metadata = build_proxy_metadata(semantics)
    doc: dict = {}

    result = apply_openapi_extensions(
        openapi_doc=doc,
        path="/chat",
        method="POST",
        metadata=metadata,
    )

    operation = result["paths"]["/chat"]["post"]
    assert operation["x-proxy"]["metered"]["policy_ver"] == 2
    assert operation["x-proxy"]["entitlement"]["feature"] == "pro"


def test_apply_openapi_extensions_skips_empty_metadata():
    semantics = MethodSemantics()
    metadata = build_proxy_metadata(semantics)
    doc = {"paths": {"/chat": {"get": {"summary": "ok"}}}}

    result = apply_openapi_extensions(
        openapi_doc=doc,
        path="/chat",
        method="GET",
        metadata=metadata,
    )

    assert result["paths"]["/chat"]["get"] == {"summary": "ok"}
