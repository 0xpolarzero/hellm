import { assert as effectAssert, describe, it, layer as effectLayer } from "@effect/vitest";
import assert from "node:assert/strict";
import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as ChannelSchema from "effect/ChannelSchema";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberMap from "effect/FiberMap";
import * as FiberSet from "effect/FiberSet";
import * as Filter from "effect/Filter";
import * as FileSystem from "effect/FileSystem";
import * as Hash from "effect/Hash";
import * as JsonPatch from "effect/JsonPatch";
import * as JsonSchema from "effect/JsonSchema";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as LogLevel from "effect/LogLevel";
import * as Logger from "effect/Logger";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Pool from "effect/Pool";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as RcMap from "effect/RcMap";
import * as RcRef from "effect/RcRef";
import * as Ref from "effect/Ref";
import * as Request from "effect/Request";
import * as RequestResolver from "effect/RequestResolver";
import * as Result from "effect/Result";
import * as Resource from "effect/Resource";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaRepresentation from "effect/SchemaRepresentation";
import * as Schedule from "effect/Schedule";
import * as ScopedCache from "effect/ScopedCache";
import * as ScopedRef from "effect/ScopedRef";
import * as Semaphore from "effect/Semaphore";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as Struct from "effect/Struct";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as Take from "effect/Take";
import * as References from "effect/References";
import * as Tracer from "effect/Tracer";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import * as TestClockModule from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  adoptedEffectRuntimeModuleExports,
  adoptedEffectTypeOnlyModules,
  auditedEffectInstalledExports,
  auditedEffectInstalledExportPolicies,
} from "./effect-adoption-manifest";

describe("Effect installed export audit", () => {
  it.effect("proves adopted Effect v4 exports exist in the installed beta.84 stack", () =>
    Effect.gen(function* () {
      const installedRuntimeModules = {
        "@effect/platform-bun/BunCrypto": BunCrypto,
        "@effect/platform-bun/BunFileSystem": BunFileSystem,
        "@effect/platform-bun/BunPath": BunPath,
        "effect/Cause": Cause,
        "effect/Config": Config,
        "effect/ConfigProvider": ConfigProvider,
        "effect/Context": Context,
        "effect/Crypto": Crypto,
        "effect/DateTime": DateTime,
        "effect/Deferred": Deferred,
        "effect/Duration": Duration,
        "effect/Effect": Effect,
        "effect/Exit": Exit,
        "effect/Fiber": Fiber,
        "effect/FileSystem": FileSystem,
        "effect/Layer": Layer,
        "effect/ManagedRuntime": ManagedRuntime,
        "effect/Option": Option,
        "effect/Path": Path,
        "effect/Queue": Queue,
        "effect/Redacted": Redacted,
        "effect/Ref": Ref,
        "effect/Schedule": Schedule,
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
        "effect/SchemaAST",
        "effect/Scope",
      ]);
      type AdoptedEffectTypeOnlyCanary = {
        readonly crypto: Crypto.Crypto;
        readonly effect: Effect.Effect<string>;
        readonly fileSystem: FileSystem.FileSystem;
        readonly layer: Layer.Layer<never>;
        readonly managedRuntime: ManagedRuntime.ManagedRuntime<never, never>;
        readonly path: Path.Path;
        readonly redacted: Redacted.Redacted<string>;
        readonly schema: Schema.Schema<string>;
        readonly schemaAstParseOptions: SchemaAST.ParseOptions;
        readonly scope: Scope.Scope;
      };
      const typeOnlyCanary: AdoptedEffectTypeOnlyCanary | null = null;
      assert.strictEqual(typeOnlyCanary, null, "Adopted type-only Effect imports must compile");

      const auditedRuntimeModules = {
        "@effect/platform-bun/BunCrypto": BunCrypto,
        "@effect/platform-bun/BunFileSystem": BunFileSystem,
        "@effect/platform-bun/BunPath": BunPath,
        "effect/Cache": Cache,
        "effect/Cause": Cause,
        "effect/Channel": Channel,
        "effect/ChannelSchema": ChannelSchema,
        "effect/Config": Config,
        "effect/ConfigProvider": ConfigProvider,
        "effect/Context": Context,
        "effect/Clock": Clock,
        "effect/Crypto": Crypto,
        "effect/Data": Data,
        "effect/DateTime": DateTime,
        "effect/Deferred": Deferred,
        "effect/Duration": Duration,
        "effect/Effect": Effect,
        "effect/Encoding": Encoding,
        "effect/Equal": Equal,
        "effect/Exit": Exit,
        "effect/Fiber": Fiber,
        "effect/FiberHandle": FiberHandle,
        "effect/FiberMap": FiberMap,
        "effect/FiberSet": FiberSet,
        "effect/Filter": Filter,
        "effect/FileSystem": FileSystem,
        "effect/Hash": Hash,
        "effect/JsonPatch": JsonPatch,
        "effect/JsonSchema": JsonSchema,
        "effect/Latch": Latch,
        "effect/Layer": Layer,
        "effect/LayerMap": LayerMap,
        "effect/Logger": Logger,
        "effect/LogLevel": LogLevel,
        "effect/ManagedRuntime": ManagedRuntime,
        "effect/Metric": Metric,
        "effect/Option": Option,
        "effect/Path": Path,
        "effect/PlatformError": PlatformError,
        "effect/Pool": Pool,
        "effect/PubSub": PubSub,
        "effect/Queue": Queue,
        "effect/Random": Random,
        "effect/References": References,
        "effect/Ref": Ref,
        "effect/Request": Request,
        "effect/RequestResolver": RequestResolver,
        "effect/Redacted": Redacted,
        "effect/Result": Result,
        "effect/Resource": Resource,
        "effect/RcMap": RcMap,
        "effect/RcRef": RcRef,
        "effect/Schema": Schema,
        "effect/SchemaAST": SchemaAST,
        "effect/SchemaIssue": SchemaIssue,
        "effect/SchemaRepresentation": SchemaRepresentation,
        "effect/Schedule": Schedule,
        "effect/ScopedCache": ScopedCache,
        "effect/Scope": Scope,
        "effect/ScopedRef": ScopedRef,
        "effect/Semaphore": Semaphore,
        "effect/Sink": Sink,
        "effect/Stream": Stream,
        "effect/Struct": Struct,
        "effect/SubscriptionRef": SubscriptionRef,
        "effect/SynchronizedRef": SynchronizedRef,
        "effect/Take": Take,
        "effect/Tracer": Tracer,
        "effect/testing": { TestClock },
        "effect/testing/TestClock": TestClockModule,
        "effect/unstable/process": { ChildProcess, ChildProcessSpawner },
        "@effect/vitest": { assert: effectAssert, describe, it, layer: effectLayer },
      } as const;

      for (const entry of auditedEffectInstalledExports) {
        assert.strictEqual(entry.scope, "installed-export-audit");
        assert.strictEqual(entry.owner, "docs/specs/package-architecture/effect-v4.spec.md");
        assert.strictEqual(entry.verifiedOn, "2026-06-25");
        const namespace = auditedRuntimeModules[entry.module as keyof typeof auditedRuntimeModules];
        assert.notStrictEqual(namespace, undefined, `${entry.module} must be audit-bound`);
        for (const member of entry.members) {
          const value = readDottedMember(namespace as Record<string, unknown>, member);
          assert.notStrictEqual(
            value,
            undefined,
            `${entry.module}.${member} must be an installed audited export`,
          );
        }
      }
      assert.strictEqual(
        typeof TestClock.adjust,
        "function",
        "TestClock.adjust must remain available",
      );
      assert.strictEqual(
        typeof TestClock.setTime,
        "function",
        "TestClock.setTime must remain available",
      );
      assert.strictEqual(
        typeof TestClock.withLive,
        "function",
        "TestClock.withLive must remain available",
      );
      assert.strictEqual(
        typeof ChildProcess.make,
        "function",
        "ChildProcess.make must remain available",
      );
      assert.strictEqual(
        typeof ChildProcessSpawner.ChildProcessSpawner,
        "function",
        "ChildProcessSpawner.ChildProcessSpawner must remain available",
      );
      const auditedModules = auditedEffectInstalledExports.map((entry) => entry.module).toSorted();
      const policyModules = auditedEffectInstalledExportPolicies
        .map((entry) => entry.module)
        .toSorted();
      assert.deepStrictEqual(
        policyModules,
        auditedModules,
        "Every installed-export audit row must have exactly one adoption policy.",
      );
      assert.deepStrictEqual(
        adoptedEffectRuntimeModuleExports
          .map((entry) => entry.module)
          .filter((module) => !auditedModules.includes(module))
          .toSorted(),
        [],
        "Every adopted production Effect module must also have installed-export audit and policy coverage.",
      );
      assert.deepStrictEqual(
        countAuditPoliciesByState(auditedEffectInstalledExportPolicies),
        {
          "adoptable-member-gated": 40,
          conditional: 21,
          "scoped-adoptable-member-gated": 8,
          "test-only": 3,
        },
        "Audit policy counts must distinguish production permission from installed canaries.",
      );

      let scopedFinalizerRan = false;
      const scopedValue = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Effect.sync(() => void (scopedFinalizerRan = true)));
          return "scoped-value";
        }),
      );
      assert.strictEqual(scopedValue, "scoped-value", "Effect.scoped must return the scoped value");
      assert.strictEqual(scopedFinalizerRan, true, "Effect.scoped must close its scope");

      yield* Effect.yieldNow;

      class ServiceHelperCanary extends Context.Service<
        ServiceHelperCanary,
        { readonly value: string }
      >()("svvy/effect-audit/ServiceHelperCanary") {}
      const serviceHelperImplementation = ServiceHelperCanary.of({ value: "service-helper" });
      const serviceHelperLayer = Layer.succeed(ServiceHelperCanary, serviceHelperImplementation);
      const serviceUseValue = yield* ServiceHelperCanary.use((service) =>
        Effect.succeed(`${service.value}:use`),
      ).pipe(Effect.provide(serviceHelperLayer));
      assert.strictEqual(serviceUseValue, "service-helper:use");
      const serviceUseSyncValue = yield* ServiceHelperCanary.useSync(
        (service) => `${service.value}:useSync`,
      ).pipe(Effect.provide(serviceHelperLayer));
      assert.strictEqual(serviceUseSyncValue, "service-helper:useSync");

      class ProvideMergeBase extends Context.Service<
        ProvideMergeBase,
        { readonly value: string }
      >()("svvy/effect-audit/ProvideMergeBase") {}
      class ProvideMergeDerived extends Context.Service<
        ProvideMergeDerived,
        { readonly value: string }
      >()("svvy/effect-audit/ProvideMergeDerived") {}
      const provideMergeDerivedLayer = Layer.effect(
        ProvideMergeDerived,
        Effect.map(ProvideMergeBase, (base) => ({
          value: `${base.value}:derived`,
        })),
      );
      const provideMergeValue = yield* ProvideMergeDerived.pipe(
        Effect.provide(
          provideMergeDerivedLayer.pipe(
            Layer.provideMerge(Layer.succeed(ProvideMergeBase, { value: "base" })),
          ),
        ),
      );
      assert.strictEqual(provideMergeValue.value, "base:derived");

      const scope = yield* Scope.make();
      assert.strictEqual(typeof Scope.provide(scope), "function", "Scope.provide must curry");
      assert.strictEqual(typeof Scope.use(scope), "function", "Scope.use must curry");
      yield* Scope.close(scope, Exit.void);

      const queue = yield* Queue.make<string>();
      const enqueue = Queue.asEnqueue(queue);
      const dequeue = Queue.asDequeue(queue);
      assert.strictEqual(typeof enqueue, "object", "Queue.asEnqueue must return enqueue handle");
      assert.strictEqual(typeof dequeue, "object", "Queue.asDequeue must return dequeue handle");
      assert.strictEqual(yield* Queue.offer(enqueue, "queued"), true);
      assert.strictEqual(yield* Queue.take(dequeue), "queued");
      yield* Queue.end(queue);
      const interruptQueue = yield* Queue.make<string>();
      yield* Queue.offer(interruptQueue, "buffered-a");
      yield* Queue.offer(interruptQueue, "buffered-b");
      yield* Queue.interrupt(interruptQueue);
      assert.strictEqual(yield* Queue.take(interruptQueue), "buffered-a");
      assert.strictEqual(yield* Queue.take(interruptQueue), "buffered-b");
      assert.strictEqual(Exit.isFailure(yield* Effect.exit(Queue.take(interruptQueue))), true);
      assert.strictEqual(yield* Queue.offer(interruptQueue, "after-interrupt"), false);

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

      const callbackStream = Stream.callback<number>(
        (callbackQueue) => {
          return Effect.gen(function* () {
            yield* Queue.offer(callbackQueue, 1);
            yield* Queue.end(callbackQueue);
          });
        },
        { bufferSize: 8, strategy: "sliding" },
      );
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

      const forkChildWithOptions = Effect.forkChild(Effect.void, {
        startImmediately: true,
        uninterruptible: "inherit",
      });
      const forkScopedWithOptions = Effect.forkScoped(Effect.void, {
        startImmediately: false,
        uninterruptible: true,
      });
      const forkScope = yield* Scope.make();
      const forkInWithOptions = Effect.forkIn(Effect.void, forkScope, {
        startImmediately: true,
        uninterruptible: false,
      });
      const uninterruptibleEffect = Effect.uninterruptible(Effect.void);
      const uninterruptibleMaskEffect = Effect.uninterruptibleMask((restore) =>
        restore(Effect.void),
      );
      assert.strictEqual(
        typeof forkChildWithOptions,
        "object",
        "Effect.forkChild must accept beta.84 fork options",
      );
      assert.strictEqual(
        typeof forkScopedWithOptions,
        "object",
        "Effect.forkScoped must accept beta.84 fork options",
      );
      assert.strictEqual(
        typeof forkInWithOptions,
        "object",
        "Effect.forkIn must accept beta.84 fork options",
      );
      assert.strictEqual(
        typeof uninterruptibleEffect,
        "object",
        "Effect.uninterruptible must construct an Effect",
      );
      assert.strictEqual(
        typeof uninterruptibleMaskEffect,
        "object",
        "Effect.uninterruptibleMask must construct an Effect",
      );
      yield* Scope.close(forkScope, Exit.void);

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
      const redactedConfig = Config.redacted("SECRET");
      const wrappedConfig = Config.unwrap({ example: Config.string("EXAMPLE") });
      const configWithDefault = Config.withDefault(Config.nonEmptyString("OPTIONAL"), "fallback");
      const configFallback = Config.orElse(configWithDefault, () => Config.string("ALTERNATE"));
      const unknownProvider = ConfigProvider.fromUnknown({ example: { value: "ok" } });
      const constantProvider = ConfigProvider.constantCase(unknownProvider);
      const nestedProvider = ConfigProvider.nested(unknownProvider, "APP");
      const replacementLayer = ConfigProvider.layer(unknownProvider);
      const additiveLayer = ConfigProvider.layerAdd(unknownProvider);
      assert.strictEqual(typeof schemaConfig, "object", "Config.schema must construct a Config");
      assert.strictEqual(
        typeof redactedConfig,
        "object",
        "Config.redacted must construct a Config",
      );
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
        typeof replacementLayer,
        "object",
        "ConfigProvider.layer must construct a layer",
      );
      assert.strictEqual(
        typeof additiveLayer,
        "object",
        "ConfigProvider.layerAdd must construct a layer",
      );

      const tracerLayer = Logger.layer([Logger.tracerLogger]);
      const batchedTracerLogger = Logger.batched(Logger.tracerLogger, {
        window: Duration.millis(10),
        flush: () => Effect.void,
      });
      assert.strictEqual(
        typeof tracerLayer,
        "object",
        "Logger.layer([Logger.tracerLogger]) must construct a layer",
      );
      assert.strictEqual(
        typeof batchedTracerLogger,
        "object",
        "Logger.batched must construct a scoped logger effect",
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
      yield* Effect.scoped(
        Effect.gen(function* () {
          const auditLayerMap = yield* LayerMap.make(
            (key: string) => Layer.succeed(AuditLayerMapDependency, { value: `make:${key}` }),
            { idleTimeToLive: "1 minute" },
          );

          assert.strictEqual(typeof auditLayerMap.get, "function", "LayerMap.make.get exists");
          assert.strictEqual(
            typeof auditLayerMap.contextEffect,
            "function",
            "LayerMap.make.contextEffect exists",
          );
          assert.strictEqual(
            typeof auditLayerMap.invalidate,
            "function",
            "LayerMap.make.invalidate exists",
          );

          const context = yield* auditLayerMap.contextEffect("canary");
          assert.strictEqual(Context.get(context, AuditLayerMapDependency).value, "make:canary");
          yield* auditLayerMap.invalidate("canary");
        }),
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
      assert.strictEqual(
        typeof Metric.enableRuntimeMetricsLayer,
        "object",
        "Metric.enableRuntimeMetricsLayer must be a Layer value",
      );
      assert.strictEqual(
        typeof Metric.disableRuntimeMetricsLayer,
        "object",
        "Metric.disableRuntimeMetricsLayer must be a Layer value",
      );
      assert.strictEqual(
        typeof Metric.enableRuntimeMetrics(Effect.void),
        "object",
        "Metric.enableRuntimeMetrics must wrap an Effect",
      );
      assert.strictEqual(
        typeof Metric.disableRuntimeMetrics(Effect.void),
        "object",
        "Metric.disableRuntimeMetrics must wrap an Effect",
      );
      assert.strictEqual(
        Array.isArray(Metric.snapshotUnsafe(Context.empty())),
        true,
        "Metric.snapshotUnsafe must synchronously read snapshots from a Context",
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
    }),
  );

  class VitestLayerBase extends Context.Service<VitestLayerBase, { readonly value: string }>()(
    "svvy/effect-audit/VitestLayerBase",
  ) {}
  class VitestLayerNested extends Context.Service<VitestLayerNested, { readonly value: string }>()(
    "svvy/effect-audit/VitestLayerNested",
  ) {}

  effectLayer(Layer.succeed(VitestLayerBase, { value: "layer" }), {
    timeout: "5 seconds",
    excludeTestServices: false,
  })("@effect/vitest layer canaries", (layerIt) => {
    layerIt.effect.each([
      ["direct", "layer"],
      ["derived", "layer:derived"],
    ] as const)("proves it.effect.each installed shape for %s", ([kind, expected]) =>
      Effect.gen(function* () {
        const base = yield* VitestLayerBase;
        const actual = kind === "direct" ? base.value : `${base.value}:derived`;
        assert.strictEqual(actual, expected);
      }),
    );

    layerIt.layer(
      Layer.effect(
        VitestLayerNested,
        Effect.map(VitestLayerBase, (base) => ({ value: `${base.value}:nested` })),
      ),
      { timeout: "5 seconds" },
    )("proves nested it.layer installed shape", (nestedIt) => {
      nestedIt.effect("provides merged parent and nested contexts", () =>
        Effect.gen(function* () {
          const base = yield* VitestLayerBase;
          const nested = yield* VitestLayerNested;
          assert.strictEqual(base.value, "layer");
          assert.strictEqual(nested.value, "layer:nested");
        }),
      );
    });
  });
});

function readDottedMember(namespace: Record<string, unknown>, member: string): unknown {
  return member
    .split(".")
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      namespace,
    );
}

function countAuditPoliciesByState(
  policies: readonly { readonly adoptionState: string }[],
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(
      policies.reduce<Record<string, number>>((counts, policy) => {
        counts[policy.adoptionState] = (counts[policy.adoptionState] ?? 0) + 1;
        return counts;
      }, {}),
    ).toSorted(([left], [right]) => left.localeCompare(right)),
  );
}
