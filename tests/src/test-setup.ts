class DurableObjectStub {
  ctx: unknown;
  env: unknown;

  constructor(state: unknown, env: unknown) {
    this.ctx = state;
    this.env = env;
  }
}

(globalThis as any).DurableObject = DurableObjectStub;
