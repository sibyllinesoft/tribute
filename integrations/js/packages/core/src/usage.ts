export interface UsageReport {
  finalPrice?: number;
  usage: Record<string, unknown>;
  responseBytes: number;
}

export class UsageTracker {
  private bytes = 0;
  private usage: Record<string, unknown> = {};
  private finalPrice?: number;

  addChunk(chunk: Buffer | string) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    this.bytes += buffer.byteLength;
  }

  setUsage(usage: Record<string, unknown>) {
    this.usage = { ...this.usage, ...usage };
  }

  setFinalPrice(price?: number) {
    this.finalPrice = price;
  }

  build(): UsageReport {
    return {
      finalPrice: this.finalPrice,
      usage: { ...this.usage },
      responseBytes: this.bytes,
    };
  }
}

export function enrichResponse(
  body: Buffer,
  usage?: Record<string, unknown>,
  finalPrice?: number,
): { body: Buffer; report: UsageReport } {
  const tracker = new UsageTracker();
  tracker.addChunk(body);
  if (usage) tracker.setUsage(usage);
  tracker.setFinalPrice(finalPrice);
  return { body, report: tracker.build() };
}

export function wrapIterable(iterable: Iterable<Buffer | string>, tracker = new UsageTracker()) {
  return {
    *[Symbol.iterator]() {
      for (const chunk of iterable) {
        tracker.addChunk(chunk);
        yield chunk;
      }
    },
    tracker,
  };
}
