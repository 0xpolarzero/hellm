import { describe, expect, it } from "bun:test";
import { ProviderAuthStatusStatePort, type ProviderAuthStatusStatePortService } from "@svvy/core";
import * as Effect from "effect/Effect";
import { runTestEffect } from "./effect.test-support";
import { PiAdapter, layer } from "./index";

const workspaceId = "workspace_test" as never;
const openaiProviderId = "openai" as never;

describe("PiAdapter", () => {
  it("lists pi model metadata with provider auth status", async () => {
    const providerAuthStatus = {
      listProviderStatuses: () =>
        Effect.succeed([
          {
            providerId: openaiProviderId,
            workspaceId,
            health: "usable",
            redactedAccountLabel: "OpenAI key",
          },
        ]),
      recordProviderStatus: () => Effect.die("unused"),
    } satisfies ProviderAuthStatusStatePortService;

    const models = await runTestEffect(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        return yield* adapter.models.list({
          workspaceId,
          providerId: openaiProviderId,
        });
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthStatusStatePort, providerAuthStatus),
      ),
    );

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.providerId === "openai")).toBe(true);
    expect(models[0]).toMatchObject({
      providerId: openaiProviderId,
      authStatus: {
        providerId: "openai",
        workspaceId,
        health: "usable",
        redactedAccountLabel: "OpenAI key",
      },
    });
    expect(models.some((model) => model.inputModalities.includes("text"))).toBe(true);
    expect(models.some((model) => model.supportedReasoning.includes("off"))).toBe(true);
  });

  it("marks providers missing when auth status is absent", async () => {
    const providerAuthStatus = {
      listProviderStatuses: () => Effect.succeed([]),
      recordProviderStatus: () => Effect.die("unused"),
    } satisfies ProviderAuthStatusStatePortService;

    const models = await runTestEffect(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        return yield* adapter.models.list({
          workspaceId,
          providerId: openaiProviderId,
        });
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthStatusStatePort, providerAuthStatus),
      ),
    );

    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.authStatus).toEqual({
      providerId: openaiProviderId,
      workspaceId,
      health: "missing",
    });
  });
});
