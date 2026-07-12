<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ExtensionGeneratedReadonlyBlockReadModel } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import { formatTokenCount } from "./chat-format";
  import SourceMetadataTextArea from "./ui/SourceMetadataTextArea.svelte";

  type Props = {
    block: ExtensionGeneratedReadonlyBlockReadModel;
    editor?: string;
    extensionId: string;
    footerControls?: Snippet;
    runtime: ChatRuntime;
    showTokenCount?: boolean;
  };

  let {
    block,
    editor = "system",
    extensionId,
    footerControls,
    runtime,
    showTokenCount = true,
  }: Props = $props();

  const openablePath = $derived(Boolean(block.source) && block.openable !== false);

  async function openExternal() {
    if (!openablePath) return;
    if (!block.source) return;
    await runtime.openSourceInEditor(block.source);
  }
</script>

<SourceMetadataTextArea
  value={block.content}
  aria-label={`${block.name} generated content`}
  readonly
  showTokenCount={showTokenCount}
  tokenCountLabel={showTokenCount ? `~${formatTokenCount(block.tokenCount.tokens)} tokens` : null}
  sourceLabel={block.name}
  sourceEditor={editor as never}
  sourceDisabled={!openablePath}
  onOpenSource={openExternal}
>
  {#snippet footerLeading()}
    {#if footerControls}
      {@render footerControls()}
    {/if}
  {/snippet}
</SourceMetadataTextArea>
