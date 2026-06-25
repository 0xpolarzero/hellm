import { assert, describe, effect as it, layer as effectLayer } from "@effect/vitest";
import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberMap from "effect/FiberMap";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Logger from "effect/Logger";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as RcMap from "effect/RcMap";
import * as RcRef from "effect/RcRef";
import * as Ref from "effect/Ref";
import * as Resource from "effect/Resource";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Take from "effect/Take";
import type * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  adoptedEffectRuntimeModuleExports,
  adoptedEffectTypeOnlyModules,
} from "./effect-adoption-manifest";

describe("Effect installed export audit", () => {
  it("proves adopted Effect v4 exports exist in the installed beta.84 stack", () =>
    Effect.gen(function* () {
      const installedRuntimeModules = {
        "@effect/platform-bun/BunCrypto": BunCrypto,
        "@effect/platform-bun/BunFileSystem": BunFileSystem,
        "@effect/platform-bun/BunPath": BunPath,
        "effect/Cause": Cause,
        "effect/Config": Config,
        "effect/Context": Context,
        "effect/DateTime": DateTime,
        "effect/Deferred": Deferred,
        "effect/Effect": Effect,
        "effect/Exit": Exit,
        "effect/FileSystem": FileSystem,
        "effect/Layer": Layer,
        "effect/ManagedRuntime": ManagedRuntime,
        "effect/Option": Option,
        "effect/Path": Path,
        "effect/Queue": Queue,
        "effect/Ref": Ref,
        "effect/Schema": Schema,
        "effect/SchemaIssue": SchemaIssue,
        "effect/Scope": Scope,
        "effect/Semaphore": Semaphore,
        "effect/Stream": Stream,
      } as const;

      for (const { module, members } of adoptedEffectRuntimeModuleExports) {
        const namespace = installedRuntimeModules[module as keyof typeof installedRuntimeModules];
        assert.notStrictEqual(
          namespace,
          undefined,
          `${module} must be installed and manifest-bound`,
        );
        for (const member of members) {
          assert.notStrictEqual(
            (namespace as Record<string, unknown>)[member],
            undefined,
            `${module}.${member} must be an installed export`,
          );
        }
      }

      assert.deepStrictEqual(adoptedEffectTypeOnlyModules, [
        "effect/Crypto",
        "effect/Effect",
        "effect/FileSystem",
        "effect/Layer",
        "effect/ManagedRuntime",
        "effect/Path",
        "effect/Redacted",
        "effect/Schema",
      ]);
      const redactedTypeProof: Redacted.Redacted<string> | null = null;
      assert.strictEqual(redactedTypeProof, null, "Redacted type import must compile");

      const adoptedFunctions = [
        ["Config.nonEmptyString", Config.nonEmptyString],
        ["Config.orElse", Config.orElse],
        ["Config.schema", Config.schema],
        ["Config.unwrap", Config.unwrap],
        ["Config.withDefault", Config.withDefault],
        ["ConfigProvider.constantCase", ConfigProvider.constantCase],
        ["ConfigProvider.fromEnv", ConfigProvider.fromEnv],
        ["ConfigProvider.fromUnknown", ConfigProvider.fromUnknown],
        ["ConfigProvider.layer", ConfigProvider.layer],
        ["ConfigProvider.layerAdd", ConfigProvider.layerAdd],
        ["ConfigProvider.nested", ConfigProvider.nested],
        ["Crypto.make", Crypto.make],
        ["ChildProcess.make", ChildProcess.make],
        ["ChildProcessSpawner.ChildProcessSpawner", ChildProcessSpawner.ChildProcessSpawner],
        ["LayerMap.Service", LayerMap.Service],
        ["Logger.batched", Logger.batched],
        ["Logger.layer", Logger.layer],
        ["ManagedRuntime.make", ManagedRuntime.make],
        ["Metric.counter", Metric.counter],
        ["Metric.disableRuntimeMetrics", Metric.disableRuntimeMetrics],
        ["Metric.enableRuntimeMetrics", Metric.enableRuntimeMetrics],
        ["Metric.histogram", Metric.histogram],
        ["Metric.snapshotUnsafe", Metric.snapshotUnsafe],
        ["Metric.timer", Metric.timer],
        ["Metric.update", Metric.update],
        ["Metric.value", Metric.value],
        ["Metric.withAttributes", Metric.withAttributes],
        ["PubSub.bounded", PubSub.bounded],
        ["PubSub.publish", PubSub.publish],
        ["PubSub.shutdown", PubSub.shutdown],
        ["PubSub.sliding", PubSub.sliding],
        ["PubSub.subscribe", PubSub.subscribe],
        ["PubSub.unbounded", PubSub.unbounded],
        ["Queue.end", Queue.end],
        ["Queue.fail", Queue.fail],
        ["Queue.make", Queue.make],
        ["Queue.offer", Queue.offer],
        ["Queue.shutdown", Queue.shutdown],
        ["Queue.take", Queue.take],
        ["Resource.auto", Resource.auto],
        ["Resource.get", Resource.get],
        ["Resource.manual", Resource.manual],
        ["Resource.refresh", Resource.refresh],
        ["RcMap.get", RcMap.get],
        ["RcMap.invalidate", RcMap.invalidate],
        ["RcMap.make", RcMap.make],
        ["RcMap.touch", RcMap.touch],
        ["RcRef.get", RcRef.get],
        ["RcRef.invalidate", RcRef.invalidate],
        ["RcRef.make", RcRef.make],
        ["Scope.close", Scope.close],
        ["Scope.make", Scope.make],
        ["Scope.provide", Scope.provide],
        ["Scope.use", Scope.use],
        ["Stream.callback", Stream.callback],
        ["Stream.fromPubSubTake", Stream.fromPubSubTake],
        ["Stream.fromSubscription", Stream.fromSubscription],
        ["Stream.toAsyncIterableEffect", Stream.toAsyncIterableEffect],
        ["Stream.toAsyncIterableWith", Stream.toAsyncIterableWith],
        ["SubscriptionRef.changes", SubscriptionRef.changes],
        ["SubscriptionRef.get", SubscriptionRef.get],
        ["SubscriptionRef.make", SubscriptionRef.make],
        ["SubscriptionRef.modify", SubscriptionRef.modify],
        ["SubscriptionRef.set", SubscriptionRef.set],
        ["SubscriptionRef.update", SubscriptionRef.update],
        ["Take.toPull", Take.toPull],
        ["TestClock.adjust", TestClock.adjust],
        ["TestClock.setTime", TestClock.setTime],
        ["TestClock.withLive", TestClock.withLive],
        ["Crypto.Crypto", Crypto.Crypto],
      ] as const;

      const adoptedLayers = [
        ["BunCrypto.layer", BunCrypto.layer],
        ["BunFileSystem.layer", BunFileSystem.layer],
        ["BunPath.layer", BunPath.layer],
        ["Metric.disableRuntimeMetricsLayer", Metric.disableRuntimeMetricsLayer],
        ["Metric.enableRuntimeMetricsLayer", Metric.enableRuntimeMetricsLayer],
      ] as const;

      const adoptedValues = [
        ["Logger.tracerLogger", Logger.tracerLogger],
        ["Metric.snapshot", Metric.snapshot],
      ] as const;

      for (const [name, value] of adoptedFunctions) {
        assert.strictEqual(
          typeof value,
          "function",
          `${name} must be an installed function export`,
        );
      }
      for (const [name, value] of adoptedLayers) {
        assert.strictEqual(typeof value, "object", `${name} must be an installed layer export`);
      }
      for (const [name, value] of adoptedValues) {
        assert.strictEqual(typeof value, "object", `${name} must be an installed value export`);
      }

      assert.strictEqual(typeof it, "function", "@effect/vitest effect must be installed");
      assert.strictEqual(typeof effectLayer, "function", "@effect/vitest layer must be installed");

      const scope = yield* Scope.make();
      assert.strictEqual(typeof Scope.provide(scope), "function", "Scope.provide must curry");
      assert.strictEqual(typeof Scope.use(scope), "function", "Scope.use must curry");
      yield* Scope.close(scope, Exit.void);

      const queue = yield* Queue.make<string>();
      yield* Queue.offer(queue, "queued");
      assert.strictEqual(yield* Queue.take(queue), "queued");
      yield* Queue.end(queue);

      const pubsub = yield* PubSub.sliding<string>({ capacity: 2, replay: 1 });
      const subscription = yield* PubSub.subscribe(pubsub);
      assert.strictEqual(
        typeof Stream.fromSubscription(subscription),
        "object",
        "Stream.fromSubscription must construct a stream",
      );
      yield* PubSub.publish(pubsub, "published");
      yield* PubSub.shutdown(pubsub);

      const takePull = Take.toPull(["taken"]);
      assert.strictEqual(typeof takePull, "object", "Take.toPull must construct a pull value");

      const callbackStream = Stream.callback<number>((callbackQueue) => {
        return Effect.sync(() => {
          Queue.offerUnsafe(callbackQueue, 1);
          Queue.endUnsafe(callbackQueue);
        });
      });
      assert.strictEqual(
        typeof callbackStream,
        "object",
        "Stream.callback must construct a stream",
      );

      const takePubSub = yield* PubSub.sliding<Take.Take<number>>({ capacity: 2, replay: 1 });
      assert.strictEqual(
        typeof Stream.fromPubSubTake(takePubSub),
        "object",
        "Stream.fromPubSubTake must construct a stream",
      );
      yield* PubSub.shutdown(takePubSub);

      const fiberMap = yield* FiberMap.make<string>();
      yield* FiberMap.run(fiberMap, "audit", Effect.succeed("done"));
      yield* FiberMap.awaitEmpty(fiberMap);

      const fiberHandle = yield* FiberHandle.make<string>();
      yield* FiberHandle.run(fiberHandle, Effect.succeed("done"));
      yield* FiberHandle.awaitEmpty(fiberHandle);
      yield* FiberHandle.clear(fiberHandle);

      const resource = yield* Resource.manual(Effect.succeed("resource"));
      assert.strictEqual(yield* Resource.get(resource), "resource");
      yield* Resource.refresh(resource);

      const rcMap = yield* RcMap.make({
        lookup: (key: string) => Effect.succeed(`value:${key}`),
      });
      assert.strictEqual(yield* RcMap.get(rcMap, "key"), "value:key");
      yield* RcMap.touch(rcMap, "key");
      yield* RcMap.invalidate(rcMap, "key");

      const rcRef = yield* RcRef.make({
        acquire: Effect.succeed("ref"),
      });
      assert.strictEqual(yield* RcRef.get(rcRef), "ref");
      yield* RcRef.invalidate(rcRef);

      const schemaConfig = Config.schema(Schema.Struct({ value: Schema.String }), "example");
      const wrappedConfig = Config.unwrap({ example: Config.string("EXAMPLE") });
      const configWithDefault = Config.withDefault(Config.nonEmptyString("OPTIONAL"), "fallback");
      const configFallback = Config.orElse(configWithDefault, () => Config.string("ALTERNATE"));
      const unknownProvider = ConfigProvider.fromUnknown({ example: { value: "ok" } });
      const constantProvider = ConfigProvider.constantCase(unknownProvider);
      const nestedProvider = ConfigProvider.nested(unknownProvider, "APP");
      const additiveLayer = ConfigProvider.layerAdd(unknownProvider);
      assert.strictEqual(typeof schemaConfig, "object", "Config.schema must construct a Config");
      assert.strictEqual(typeof wrappedConfig, "object", "Config.unwrap must construct a Config");
      assert.strictEqual(typeof configFallback, "object", "Config.orElse must construct a Config");
      assert.strictEqual(
        typeof constantProvider,
        "object",
        "ConfigProvider.constantCase must construct a provider",
      );
      assert.strictEqual(
        typeof nestedProvider,
        "object",
        "ConfigProvider.nested must construct a provider",
      );
      assert.strictEqual(
        typeof additiveLayer,
        "object",
        "ConfigProvider.layerAdd must construct a layer",
      );

      const tracerLayer = Logger.layer([Logger.tracerLogger]);
      assert.strictEqual(
        typeof tracerLayer,
        "object",
        "Logger.layer([Logger.tracerLogger]) must construct a layer",
      );

      interface AuditLayerMapDependency {
        readonly _tag: "AuditLayerMapDependency";
      }
      const AuditLayerMapDependency = Context.Service<
        AuditLayerMapDependency,
        { readonly value: string }
      >("@svvy/effect-installed-exports/AuditLayerMapDependency");
      class AuditLayerMap extends LayerMap.Service<AuditLayerMap>()(
        "@svvy/effect-installed-exports/AuditLayerMap",
        {
          lookup: (key: string) => Layer.succeed(AuditLayerMapDependency, { value: key }),
        },
      ) {}
      assert.strictEqual(typeof AuditLayerMap.layer, "object", "LayerMap.Service.layer exists");
      assert.strictEqual(
        typeof AuditLayerMap.layerNoDeps,
        "object",
        "LayerMap.Service.layerNoDeps exists",
      );
      assert.strictEqual(typeof AuditLayerMap.get, "function", "LayerMap.Service.get exists");
      assert.strictEqual(
        typeof AuditLayerMap.contextEffect,
        "function",
        "LayerMap.Service.contextEffect exists",
      );
      assert.strictEqual(
        typeof AuditLayerMap.invalidate,
        "function",
        "LayerMap.Service.invalidate exists",
      );

      const TestCrypto = Layer.succeed(
        Crypto.Crypto,
        Crypto.make({
          randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index),
          digest: (_algorithm, data) => Effect.succeed(data),
        }),
      );
      const cryptoResult = yield* Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const bytes = yield* crypto.randomBytes(4);
        const digest = yield* crypto.digest("SHA-256", bytes);
        const uuidv4 = yield* crypto.randomUUIDv4;
        const uuidv7 = yield* crypto.randomUUIDv7;
        return { bytes, digest, uuidv4, uuidv7 };
      }).pipe(Effect.provide(TestCrypto));
      assert.deepStrictEqual(Array.from(cryptoResult.bytes), [0, 1, 2, 3]);
      assert.deepStrictEqual(Array.from(cryptoResult.digest), [0, 1, 2, 3]);
      assert.strictEqual(cryptoResult.uuidv4.length, 36);
      assert.strictEqual(cryptoResult.uuidv7.length, 36);

      const metricSnapshots = yield* Metric.snapshot;
      assert.strictEqual(
        Array.isArray(metricSnapshots),
        true,
        "Metric.snapshot must be yieldable as an Effect value",
      );

      const subscriptionRef = yield* SubscriptionRef.make("initial");
      assert.strictEqual(yield* SubscriptionRef.get(subscriptionRef), "initial");
      assert.strictEqual(
        typeof SubscriptionRef.changes(subscriptionRef),
        "object",
        "SubscriptionRef.changes must return a Stream value",
      );
      yield* SubscriptionRef.set(subscriptionRef, "set");
      yield* SubscriptionRef.update(subscriptionRef, (value) => `${value}-updated`);
      const modifiedFrom = yield* SubscriptionRef.modify(subscriptionRef, (value) => [
        value,
        "modified",
      ]);
      assert.strictEqual(modifiedFrom, "set-updated");
      assert.strictEqual(yield* SubscriptionRef.get(subscriptionRef), "modified");
    }));
});
