import * as Effect from "effect/Effect";

export function runTestEffect<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>);
}

export function runTestEffectSync<A, E, R>(effect: Effect.Effect<A, E, R>): A {
  return Effect.runSync(effect as Effect.Effect<A, E, never>);
}

export function runScopedTestEffect<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
  return runTestEffect(Effect.scoped(effect));
}
