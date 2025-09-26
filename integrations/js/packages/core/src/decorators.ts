export interface MethodSemantics {
  metered?: Record<string, unknown>;
  entitlement?: Record<string, unknown>;
  cacheable?: Record<string, unknown>;
  estimateHandler?: (...args: unknown[]) => unknown | Promise<unknown>;
}

const SEMANTICS = Symbol.for("tribute.semantics");

function ensureSemantics(target: Function): MethodSemantics {
  const existing = (target as any)[SEMANTICS];
  if (existing) return existing as MethodSemantics;
  const semantics: MethodSemantics = {};
  Object.defineProperty(target, SEMANTICS, {
    value: semantics,
    enumerable: false,
    configurable: true,
  });
  return semantics;
}

function attachEstimate<T extends Function>(fn: T, semantics: MethodSemantics): T {
  const wrapper = function (this: unknown, ...args: unknown[]) {
    return fn.apply(this, args as never);
  } as unknown as T;

  Object.defineProperty(wrapper, SEMANTICS, {
    value: semantics,
    enumerable: false,
  });

  Object.defineProperty(wrapper, "estimate", {
    value: (estimator: (...args: unknown[]) => unknown) => {
      semantics.estimateHandler = estimator;
      return estimator;
    },
    enumerable: false,
  });

  return wrapper;
}

export function metered(options: Record<string, unknown>) {
  return function <T extends Function>(handler: T): T {
    const semantics = ensureSemantics(handler);
    semantics.metered = { ...options };
    return attachEstimate(handler, semantics);
  };
}

export function entitlement(options: Record<string, unknown>) {
  return function <T extends Function>(handler: T): T {
    const semantics = ensureSemantics(handler);
    semantics.entitlement = { ...options };
    return attachEstimate(handler, semantics);
  };
}

export function cacheable(options: Record<string, unknown>) {
  return function <T extends Function>(handler: T): T {
    const semantics = ensureSemantics(handler);
    semantics.cacheable = { ...options };
    return attachEstimate(handler, semantics);
  };
}

export function resolveSemantics(target: Function): MethodSemantics {
  return ensureSemantics(target);
}

export function estimateHandler(target: Function) {
  return ensureSemantics(target).estimateHandler;
}
