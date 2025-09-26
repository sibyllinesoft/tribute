import { createHash } from "node:crypto";

export interface PolicyDigest {
  version: number;
  digest: string;
}

export class PolicyContext {
  constructor(
    public readonly policyVersion: number,
    private readonly activatedAt: Date = new Date(),
    private readonly gracePeriodMs?: number,
  ) {}

  graceDeadline(): Date | undefined {
    if (!this.gracePeriodMs) return undefined;
    return new Date(this.activatedAt.getTime() + this.gracePeriodMs);
  }

  isWithinGrace(now: Date = new Date()): boolean {
    const deadline = this.graceDeadline();
    if (!deadline) return false;
    return now.getTime() <= deadline.getTime();
  }

  requireVersion(expected: number) {
    if (expected !== this.policyVersion) {
      throw new Error(`policy version mismatch (expected ${expected}, have ${this.policyVersion})`);
    }
  }
}

export function computePolicyDigest(spec: Buffer, version: number): PolicyDigest {
  return {
    version,
    digest: createHash("sha256").update(spec).digest("hex"),
  };
}
