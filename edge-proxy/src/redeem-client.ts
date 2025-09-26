import type { RedeemBeginPayload, RedeemCommitPayload, RedeemCancelPayload, RedeemBeginResponse } from "@tribute/durable-objects";

export class RedeemClient {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  async begin(shardId: string, payload: RedeemBeginPayload): Promise<RedeemBeginResponse> {
    const stub = this.stub(shardId);
    const res = await stub.fetch("https://redeem/begin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as RedeemBeginResponse;
  }

  async commit(shardId: string, payload: RedeemCommitPayload): Promise<Response> {
    const stub = this.stub(shardId);
    return stub.fetch("https://redeem/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async cancel(shardId: string, payload: RedeemCancelPayload): Promise<Response> {
    const stub = this.stub(shardId);
    return stub.fetch("https://redeem/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  private stub(shardId: string): DurableObjectStub {
    const id = this.namespace.idFromName(shardId);
    return this.namespace.get(id);
  }
}
