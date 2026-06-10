import { describe, expect, it } from "bun:test";
import {
  AMBIENT_AGENT_RESOURCE_CATEGORIES,
  DEFAULT_AMBIENT_AGENT_RESOURCES,
  type AmbientAgentResourcesSettings,
} from "./agent-settings";
import { resolveAmbientAgentResourceBindings } from "./ambient-agent-resources";

function settings(input: Partial<AmbientAgentResourcesSettings>): AmbientAgentResourcesSettings {
  return {
    categories: {
      ...Object.fromEntries(
        AMBIENT_AGENT_RESOURCE_CATEGORIES.map((category) => [category, { enabled: false }]),
      ),
      ...input.categories,
    } as AmbientAgentResourcesSettings["categories"],
    enablements: input.enablements ?? [],
  };
}

describe("resolveAmbientAgentResourceBindings", () => {
  it("keeps ambient resources blocked by default even when candidates exist", () => {
    expect(
      resolveAmbientAgentResourceBindings({
        settings: DEFAULT_AMBIENT_AGENT_RESOURCES,
        actor: "handler",
        profileId: "threadHandler",
        workspaceKey: "workspace:one",
        candidates: [
          {
            id: "skill-a",
            host: "pi",
            category: "skills",
            source: { kind: "path", id: "skill-a", path: "/skills/a" },
            scope: { kind: "workspace", workspaceKey: "workspace:one" },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("resolves only exact enabled source, scope, actor, and profile matches", () => {
    const resolved = resolveAmbientAgentResourceBindings({
      settings: settings({
        categories: {
          skills: { enabled: true },
        } as Partial<
          AmbientAgentResourcesSettings["categories"]
        > as AmbientAgentResourcesSettings["categories"],
        enablements: [
          {
            id: "enabled-skill",
            enabled: true,
            host: "pi",
            category: "skills",
            source: { kind: "path", id: "skill-a", path: "/skills/a" },
            scope: { kind: "workspace", workspaceKey: "workspace:one" },
            targets: [{ actor: "handler", profileId: "threadHandler" }],
          },
          {
            id: "wrong-profile",
            enabled: true,
            host: "pi",
            category: "skills",
            source: { kind: "path", id: "skill-a", path: "/skills/a" },
            scope: { kind: "workspace", workspaceKey: "workspace:one" },
            targets: [{ actor: "handler", profileId: "other" }],
          },
        ],
      }),
      actor: "handler",
      profileId: "threadHandler",
      workspaceKey: "workspace:one",
      candidates: [
        {
          id: "skill-a",
          host: "pi",
          category: "skills",
          source: { kind: "path", id: "skill-a", path: "/skills/a" },
          scope: { kind: "workspace", workspaceKey: "workspace:one" },
        },
        {
          id: "skill-other-workspace",
          host: "pi",
          category: "skills",
          source: { kind: "path", id: "skill-a", path: "/skills/a" },
          scope: { kind: "workspace", workspaceKey: "workspace:two" },
        },
      ],
    });

    expect(resolved).toEqual([
      {
        id: "skill-a",
        host: "pi",
        category: "skills",
        source: { kind: "path", id: "skill-a", path: "/skills/a" },
        scope: { kind: "workspace", workspaceKey: "workspace:one" },
        enablementId: "enabled-skill",
      },
    ]);
  });

  it("requires exact profile matches for target agent configuration", () => {
    expect(
      resolveAmbientAgentResourceBindings({
        settings: settings({
          categories: {
            promptTemplates: { enabled: true },
          } as Partial<
            AmbientAgentResourcesSettings["categories"]
          > as AmbientAgentResourcesSettings["categories"],
          enablements: [
            {
              id: "prompt-template",
              enabled: true,
              host: "claude",
              category: "promptTemplates",
              source: { kind: "global", id: "review-template" },
              scope: { kind: "app" },
              targets: [{ actor: "orchestrator" }],
            },
          ],
        }),
        actor: "orchestrator",
        profileId: "default",
        candidates: [
          {
            id: "review-template",
            host: "claude",
            category: "promptTemplates",
            source: { kind: "global", id: "review-template" },
            scope: { kind: "app" },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("blocks enabled records on disabled category, source, host, and workspace mismatches", () => {
    const ambientSettings = settings({
      categories: {
        skills: { enabled: true },
        commands: { enabled: false },
      } as Partial<
        AmbientAgentResourcesSettings["categories"]
      > as AmbientAgentResourcesSettings["categories"],
      enablements: [
        {
          id: "skill",
          enabled: true,
          host: "pi",
          category: "skills",
          source: { kind: "path", id: "skill-a", path: "/skills/a" },
          scope: { kind: "workspace", workspaceKey: "workspace:one" },
          targets: [{ actor: "handler", profileId: "threadHandler" }],
        },
        {
          id: "command",
          enabled: true,
          host: "codex",
          category: "commands",
          source: { kind: "global", id: "slash" },
          scope: { kind: "app" },
          targets: [{ actor: "handler", profileId: "threadHandler" }],
        },
      ],
    });
    const candidates = [
      {
        id: "wrong-source",
        host: "pi",
        category: "skills",
        source: { kind: "path", id: "skill-a", path: "/skills/b" },
        scope: { kind: "workspace", workspaceKey: "workspace:one" },
      },
      {
        id: "wrong-host",
        host: "codex",
        category: "skills",
        source: { kind: "path", id: "skill-a", path: "/skills/a" },
        scope: { kind: "workspace", workspaceKey: "workspace:one" },
      },
      {
        id: "category-disabled",
        host: "codex",
        category: "commands",
        source: { kind: "global", id: "slash" },
        scope: { kind: "app" },
      },
      {
        id: "workspace-needs-current-key",
        host: "pi",
        category: "skills",
        source: { kind: "path", id: "skill-a", path: "/skills/a" },
        scope: { kind: "workspace", workspaceKey: "workspace:one" },
      },
    ] as const;

    expect(
      resolveAmbientAgentResourceBindings({
        settings: ambientSettings,
        actor: "handler",
        profileId: "threadHandler",
        candidates,
      }),
    ).toEqual([]);
    expect(
      resolveAmbientAgentResourceBindings({
        settings: ambientSettings,
        actor: "handler",
        profileId: "threadHandler",
        workspaceKey: "workspace:two",
        candidates,
      }),
    ).toEqual([]);
  });

  it("allows app-scope records while a workspace is active", () => {
    const resolved = resolveAmbientAgentResourceBindings({
      settings: settings({
        categories: {
          promptTemplates: { enabled: true },
        } as Partial<
          AmbientAgentResourcesSettings["categories"]
        > as AmbientAgentResourcesSettings["categories"],
        enablements: [
          {
            id: "prompt-template",
            enabled: true,
            host: "claude",
            category: "promptTemplates",
            source: { kind: "global", id: "review-template" },
            scope: { kind: "app" },
            targets: [{ actor: "orchestrator", profileId: "default" }],
          },
        ],
      }),
      actor: "orchestrator",
      profileId: "default",
      workspaceKey: "workspace:one",
      candidates: [
        {
          id: "review-template",
          host: "claude",
          category: "promptTemplates",
          source: { kind: "global", id: "review-template" },
          scope: { kind: "app" },
        },
      ],
    });

    expect(resolved).toEqual([
      {
        id: "review-template",
        host: "claude",
        category: "promptTemplates",
        source: { kind: "global", id: "review-template" },
        scope: { kind: "app" },
        enablementId: "prompt-template",
      },
    ]);
  });
});
