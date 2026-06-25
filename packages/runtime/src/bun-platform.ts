import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import type { Crypto } from "effect/Crypto";
import type { FileSystem } from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type { Path } from "effect/Path";

export type RuntimeBunPlatformServices = FileSystem | Path | Crypto;

export const layerRuntimeBunPlatform: Layer.Layer<RuntimeBunPlatformServices> = Layer.mergeAll(
  BunFileSystem.layer,
  BunPath.layer,
  BunCrypto.layer,
);
