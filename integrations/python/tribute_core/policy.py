"""Policy versioning helpers."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional


@dataclass
class PolicyDigest:
    version: int
    digest: str


@dataclass
class PolicyContext:
    policy_version: int
    grace_period: Optional[timedelta] = None
    activated_at: datetime = datetime.now(timezone.utc)

    def grace_deadline(self) -> Optional[datetime]:
        if self.grace_period is None:
            return None
        return self.activated_at + self.grace_period

    def is_within_grace(self, *, now: Optional[datetime] = None) -> bool:
        deadline = self.grace_deadline()
        if deadline is None:
            return False
        cursor = now or datetime.now(timezone.utc)
        return cursor <= deadline

    def require_version(self, expected: int) -> None:
        if expected != self.policy_version:
            raise ValueError(
                f"policy version mismatch (expected {expected}, have {self.policy_version})"
            )


def compute_policy_digest(*, spec_bytes: bytes, version: int) -> PolicyDigest:
    digest = hashlib.sha256(spec_bytes).hexdigest()
    return PolicyDigest(version=version, digest=digest)
