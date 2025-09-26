from tribute_core import cacheable, estimate_handler, metered, resolve_semantics


@cacheable(ttl=30)
@metered(pricing="estimate-first", policy_ver=4)
def handler():
    return "ok"


@handler.estimate
def handler_estimate():
    return {"estimated_price": "0.1"}


def test_semantics_collected():
    semantics = resolve_semantics(handler)
    assert semantics.cacheable == {"ttl": 30}
    assert semantics.metered == {"pricing": "estimate-first", "policy_ver": 4}
    assert semantics.estimate_handler is handler_estimate
    assert estimate_handler(handler) is handler_estimate

def test_as_extension_outputs_expected_sections():
    semantics = resolve_semantics(handler)
    extension = semantics.as_extension()
    assert extension["metered"]["policy_ver"] == 4
    assert extension["estimate"] == {"available": True}


def test_estimate_handler_absent_returns_none():
    @cacheable(ttl=10)
    def undecorated():
        return "noop"

    assert estimate_handler(undecorated) is None
