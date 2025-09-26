const resolveDurableObjectBase = (): any => {
  if (typeof (globalThis as any).DurableObject === "undefined") {
    class DurableObjectShim {
      ctx: unknown;
      env: unknown;

      constructor(state: unknown, env: unknown) {
        this.ctx = state;
        this.env = env;
      }
    }

    (globalThis as any).DurableObject = DurableObjectShim;
  }

  return (globalThis as any).DurableObject;
};

export const DurableObjectBase = resolveDurableObjectBase();
