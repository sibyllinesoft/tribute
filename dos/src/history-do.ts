import { DurableObjectBase } from "./do-base";

interface HistoryEntry {
  ts: string;
  rid: string;
  finalPrice: number;
  currency: string;
  receiptId: string;
  contentHash: string;
  status: string;
  estimatedPrice?: number;
  policyVersion?: number;
}

const PAGE_SIZE = 20;

export class HistoryDurableObject extends DurableObjectBase {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState, _env: unknown) {
    super(state, _env);
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "POST" && url.pathname === "/append") {
      const body = (await request.json()) as HistoryEntry;
      const entries = (await this.storage.get<HistoryEntry[]>("entries")) ?? [];
      entries.push(body);
      await this.storage.put("entries", entries);
      return json({ ok: true });
    }

    if (method === "GET" && url.pathname === "/list") {
      const entries = (await this.storage.get<HistoryEntry[]>("entries")) ?? [];
      const cursorParam = url.searchParams.get("cursor");
      const cursor = cursorParam ? parseInt(cursorParam, 10) : 0;
      const slice = entries.slice(cursor, cursor + PAGE_SIZE);
      const nextCursor = cursor + slice.length < entries.length ? cursor + slice.length : null;
      return json({ entries: slice, nextCursor });
    }

    return json({ error: "not_found" }, 404);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
