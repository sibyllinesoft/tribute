from decimal import Decimal

from tribute_core import HMACSigner, JWKSManager, estimate, verify_signature


def test_estimate_signing_roundtrip():
    signer = HMACSigner(key_id="primary", secret=b"topsecret")
    manager = JWKSManager()
    manager.register(signer)

    result = estimate(
        estimated_price=Decimal("0.1234"),
        observables={"tokens": 42},
        signer=signer,
    )

    token = result.price_signature
    assert token is not None

    def resolver(kid: str):
        resolved = manager.resolve(kid)
        if not resolved:
            return None
        return resolved.secret

    assert verify_signature(token=token, key_resolver=resolver)


def test_jwks_manager_resolve_and_jwks_listing():
    manager = JWKSManager()
    signer = HMACSigner(key_id="secondary", secret=b"secret")
    manager.register(signer)

    resolved = manager.resolve("secondary")
    assert resolved is signer
    assert manager.resolve("missing") is None

    keys = manager.jwks()["keys"]
    assert keys == [{"kid": "secondary", "kty": "oct", "alg": "HS256"}]


def test_verify_signature_returns_false_for_unknown_key():
    signer = HMACSigner(key_id="k1", secret=b"secret")
    token = signer.sign_estimate(price=Decimal("1.0"), observables={})

    def resolver(_: str):
        return None

    assert verify_signature(token=token, key_resolver=resolver) is False
