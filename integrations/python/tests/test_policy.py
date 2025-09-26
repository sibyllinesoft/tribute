from datetime import datetime, timedelta, timezone

from tribute_core import PolicyContext, compute_policy_digest


def test_policy_grace_deadline_and_check():
    activated = datetime(2024, 1, 1, tzinfo=timezone.utc)
    context = PolicyContext(policy_version=3, grace_period=timedelta(days=2), activated_at=activated)

    deadline = context.grace_deadline()
    assert deadline == activated + timedelta(days=2)
    assert context.is_within_grace(now=activated + timedelta(days=1)) is True
    assert context.is_within_grace(now=activated + timedelta(days=3)) is False


def test_policy_require_version_raises():
    context = PolicyContext(policy_version=1)
    try:
        context.require_version(2)
    except ValueError as exc:
        assert "policy version mismatch" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_compute_policy_digest():
    digest = compute_policy_digest(spec_bytes=b"spec", version=5)
    assert digest.version == 5
    assert len(digest.digest) == 64
