<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import FolderGit2Icon from "@lucide/svelte/icons/folder-git-2";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import { onMount, tick } from "svelte";

  export type CompactComboboxOption = {
    value: string;
    label: string;
    triggerLabel?: string;
    searchText?: string;
    disabled?: boolean;
  };

  type Props = {
    value?: string;
    values?: string[];
    multiple?: boolean;
    options: CompactComboboxOption[];
    ariaLabel: string;
    placeholder?: string;
    disabled?: boolean;
    triggerClass?: string;
    menuClass?: string;
    optionClass?: string;
    leadingIcon?: "branch" | "workspace";
    placement?: "above" | "below";
    emptyLabel?: string;
    open?: boolean;
    onBeforeOpen?: () => void | Promise<void>;
    onSelect?: (value: string) => void | Promise<void>;
    onMultiSelect?: (values: string[]) => void | Promise<void>;
  };

  let {
    value = "",
    values = [],
    multiple = false,
    options,
    ariaLabel,
    placeholder = "Search",
    disabled = false,
    triggerClass = "",
    menuClass = "",
    optionClass = "",
    leadingIcon,
    placement = "above",
    emptyLabel = "No matches.",
    open = $bindable(false),
    onBeforeOpen,
    onSelect,
    onMultiSelect,
  }: Props = $props();

  let root = $state<HTMLDivElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let menuElement = $state<HTMLDivElement | null>(null);
  let inputElement = $state<HTMLInputElement | null>(null);
  let optionsElement = $state<HTMLDivElement | null>(null);
  let query = $state("");
  let opening = $state(false);
  let activeIndex = $state(0);
  let menuStyle = $state("");
  const listboxId = `compact-combobox-${Math.random().toString(36).slice(2)}`;
  const selectedValueSet = $derived(new Set(values));
  const selectedOption = $derived(options.find((option) => option.value === value));
  const selectedOptions = $derived(options.filter((option) => selectedValueSet.has(option.value)));
  const triggerLabel = $derived.by(() => {
    if (!multiple) {
      if (!selectedOption && !value) return placeholder;
      return selectedOption?.triggerLabel ?? selectedOption?.label ?? value;
    }
    if (selectedOptions.length === 0) return placeholder;
    if (selectedOptions.length === 1) {
      const [option] = selectedOptions;
      return option?.triggerLabel ?? option?.label ?? "";
    }
    return `${selectedOptions.length} selected`;
  });
  const filteredOptions = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => (option.searchText ?? option.label).toLowerCase().includes(normalizedQuery));
  });
  const activeOption = $derived(filteredOptions[activeIndex] ?? null);
  const activeOptionId = $derived(activeOption ? `${listboxId}-${activeIndex}` : undefined);

  $effect(() => {
    void query;
    void filteredOptions.length;
    if (activeIndex >= filteredOptions.length) {
      activeIndex = Math.max(0, filteredOptions.length - 1);
    }
  });

  $effect(() => {
    if (!open) return;
    void value;
    void values.join("\0");
    void filteredOptions.length;
    positionMenu();
  });

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || root?.contains(target) || menuElement?.contains(target)) return;
      open = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        open = false;
      }
    };

    const handleViewportChange = () => {
      if (open) {
        positionMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  });

  function portalMenu(node: HTMLElement) {
    document.body.append(node);

    return {
      destroy() {
        node.remove();
      },
    };
  }

  function clampPosition(nextValue: number, minimum: number, maximum: number) {
    if (maximum < minimum) return minimum;
    return Math.min(Math.max(nextValue, minimum), maximum);
  }

  function positionMenu() {
    if (!triggerElement) return;
    const rect = triggerElement.getBoundingClientRect();
    const gap = 5;
    const minimumWidth = menuClass.includes("model-menu") ? 256 : 128;
    const viewportPadding = 8;
    const availableWidth = Math.max(160, window.innerWidth - viewportPadding * 2);
    const targetWidth = Math.min(Math.max(rect.width, minimumWidth), availableWidth);
    const measuredRect = menuElement?.getBoundingClientRect();
    const menuWidth = Math.min(measuredRect?.width ?? targetWidth, availableWidth);
    const menuHeight = measuredRect?.height ?? (menuClass.includes("model-menu") ? 225 : 240);
    const spaceAbove = rect.top - viewportPadding - gap;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const resolvedPlacement =
      placement === "below"
        ? spaceBelow >= menuHeight || spaceBelow >= spaceAbove
          ? "below"
          : "above"
        : spaceAbove >= menuHeight || spaceAbove >= spaceBelow
          ? "above"
          : "below";
    const unclampedTop = resolvedPlacement === "below" ? rect.bottom + gap : rect.top - menuHeight - gap;
    const top = clampPosition(unclampedTop, viewportPadding, window.innerHeight - menuHeight - viewportPadding);
    const left = clampPosition(rect.left, viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    menuStyle = `left: ${left}px; top: ${top}px; width: ${targetWidth}px; max-width: ${availableWidth}px;`;
  }

  async function scrollActiveOptionIntoView() {
    await tick();
    const activeElement = activeOptionId ? document.getElementById(activeOptionId) : null;
    activeElement?.scrollIntoView({ block: "nearest" });
  }

  async function selectOption(option: CompactComboboxOption) {
    if (option.disabled) {
      return;
    }

    if (multiple) {
      const selectedValues = new Set(values);
      if (selectedValues.has(option.value)) {
        selectedValues.delete(option.value);
      } else {
        selectedValues.add(option.value);
      }
      await onMultiSelect?.([...selectedValues]);
      return;
    }

    if (option.value === value) {
      open = false;
      return;
    }

    await onSelect?.(option.value);
    open = false;
  }

  async function openMenu() {
    if (opening || disabled) return;
    opening = true;
    try {
      await onBeforeOpen?.();
      query = "";
      const selectedIndex = multiple
        ? options.findIndex((option) => selectedValueSet.has(option.value))
        : options.findIndex((option) => option.value === value);
      activeIndex = Math.max(0, selectedIndex);
      positionMenu();
      open = true;
      await tick();
      positionMenu();
      await scrollActiveOptionIntoView();
      inputElement?.focus();
      inputElement?.select();
    } finally {
      opening = false;
    }
  }

  async function toggleOpen() {
    if (open) {
      open = false;
      return;
    }
    await openMenu();
  }

  async function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(filteredOptions.length - 1, activeIndex + 1);
      await scrollActiveOptionIntoView();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      await scrollActiveOptionIntoView();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption) {
        await selectOption(activeOption);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      open = false;
    }
  }
</script>

<div class="compact-combobox" bind:this={root}>
  <button
    bind:this={triggerElement}
    class={`compact-combobox-trigger ${triggerClass}`.trim()}
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    {disabled}
    onclick={toggleOpen}
  >
    {#if leadingIcon === "branch"}
      <GitBranchIcon size={12} aria-hidden="true" />
    {:else if leadingIcon === "workspace"}
      <FolderGit2Icon size={12} aria-hidden="true" />
    {/if}
    <span class="compact-combobox-label">{triggerLabel}</span>
    <span class={`compact-combobox-caret ${open ? "open" : ""}`.trim()} aria-hidden="true">
      <ChevronDownIcon size={13} strokeWidth={1.9} />
    </span>
  </button>
  {#if open}
    <div bind:this={menuElement} use:portalMenu class={`compact-combobox-menu ${menuClass}`.trim()} style={menuStyle}>
      <div
        class="compact-combobox-options"
        bind:this={optionsElement}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable={multiple ? "true" : undefined}
      >
        {#if filteredOptions.length === 0}
          <div class="compact-combobox-empty">{emptyLabel}</div>
        {:else}
          {#each filteredOptions as option, index (option.value)}
            {@const selected = multiple ? selectedValueSet.has(option.value) : option.value === value}
            {@const active = index === activeIndex}
            <button
              id={`${listboxId}-${index}`}
              class={`compact-combobox-option ${optionClass} ${selected ? "active" : ""} ${active ? "focused" : ""}`.trim()}
              type="button"
              role="option"
              aria-selected={selected}
              data-active={active}
              disabled={option.disabled}
              onmouseenter={() => (activeIndex = index)}
              onclick={() => selectOption(option)}
            >
              {#if multiple}
                <span class={`compact-combobox-option-check ${selected ? "checked" : ""}`.trim()} aria-hidden="true">
                  {#if selected}
                    <CheckIcon size={11} strokeWidth={2.4} />
                  {/if}
                </span>
              {/if}
              <span>{option.label}</span>
            </button>
          {/each}
        {/if}
      </div>
      <input
        bind:this={inputElement}
        bind:value={query}
        class="compact-combobox-input"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded="true"
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        {placeholder}
        onkeydown={handleInputKeydown}
      />
    </div>
  {/if}
</div>

<style>
  .compact-combobox {
    position: relative;
    display: inline-flex;
    align-items: flex-start;
    min-width: 0;
    --compact-control-font-family: var(--font-mono);
    --compact-control-font-weight: 500;
  }

  .compact-combobox-trigger {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    min-width: 0;
    overflow: visible;
  }

  .compact-combobox-trigger.model-pill,
  .compact-combobox-trigger.workspace-path {
    max-width: 100%;
    min-height: 1.45rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .compact-combobox-trigger.model-pill {
    max-width: 12.5rem;
    padding: 0.08rem 0.18rem 0.08rem 0.44rem;
    color: var(--ui-text-tertiary);
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
    line-height: 1;
  }

  .compact-combobox-trigger.workspace-path {
    padding: 0 0.22rem 0 0.28rem;
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
  }

  .compact-combobox-trigger.model-pill:hover,
  .compact-combobox-trigger.model-pill:focus-visible,
  .compact-combobox-trigger.workspace-path:hover,
  .compact-combobox-trigger.workspace-path:focus-visible {
    outline: none;
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .compact-combobox-trigger.model-pill:focus-visible,
  .compact-combobox-trigger.workspace-path:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .compact-combobox-trigger.model-pill:disabled,
  .compact-combobox-trigger.workspace-path:disabled {
    cursor: default;
    opacity: 0.78;
  }

  .compact-combobox-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.35;
    padding-block: 0.08rem;
    margin-block: -0.08rem;
  }

  .compact-combobox-trigger.scope-select {
    width: fit-content;
    max-width: min(100%, 18rem);
    min-height: 1.42rem;
    padding: 0.1rem 0.24rem 0.1rem 0.38rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-muted) 54%, transparent);
    color: var(--ui-text-secondary);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    line-height: 1;
  }

  .compact-combobox-trigger.scope-select:hover,
  .compact-combobox-trigger.scope-select:focus-visible {
    outline: none;
    background: color-mix(in oklab, var(--ui-surface-muted) 72%, transparent);
    color: var(--ui-text-primary);
  }

  .compact-combobox-trigger.scope-select:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .compact-combobox-trigger.scope-select:disabled {
    cursor: default;
    opacity: 0.72;
  }

  .compact-combobox-caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.72rem;
    height: 0.72rem;
    flex: 0 0 auto;
    overflow: visible;
    pointer-events: none;
    transition: transform 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .compact-combobox-caret.open {
    transform: rotate(180deg);
  }

  .compact-combobox-menu {
    position: fixed;
    z-index: calc(var(--ui-z-dialog) - 1);
    display: grid;
    gap: 0.24rem;
    min-width: 8rem;
    max-width: min(14rem, calc(100vw - 2rem));
    padding: 0.28rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-raised) 96%, transparent);
    box-shadow:
      0 18px 48px color-mix(in oklab, var(--ui-shadow) 28%, transparent),
      0 0 0 1px color-mix(in oklab, var(--ui-surface) 60%, transparent);
    backdrop-filter: blur(16px);
    transform-origin: bottom right;
  }

  .compact-combobox-menu.branch-menu {
    min-width: 8rem;
    width: max-content;
    max-height: 15rem;
    overflow: hidden;
  }

  .compact-combobox-menu.model-menu {
    min-width: 16rem;
    max-width: min(22rem, calc(100vw - 2rem));
  }

  .compact-combobox-menu.scope-menu {
    min-width: 16rem;
    max-width: min(25rem, calc(100vw - 2rem));
  }

  .compact-combobox-input {
    width: 100%;
    min-width: 0;
    min-height: 1.55rem;
    padding: 0.18rem 0.44rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 74%, transparent);
    color: var(--ui-text-primary);
    font: inherit;
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
    outline: none;
  }

  .compact-combobox-input::placeholder {
    color: var(--ui-text-tertiary);
  }

  .compact-combobox-input:focus-visible {
    border-color: color-mix(in oklab, var(--ui-accent) 32%, var(--ui-border-soft));
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ui-accent) 10%, transparent);
  }

  .compact-combobox-options {
    display: grid;
    gap: 0;
    max-height: 11.6rem;
    overflow: auto;
  }

  .compact-combobox-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    min-height: 1.8rem;
    padding: 0 0.56rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--compact-control-font-weight);
    text-align: left;
    cursor: pointer;
  }

  .compact-combobox-option.branch-option {
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
  }

  .compact-combobox-option.model-option {
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
  }

  .compact-combobox-option.scope-option {
    justify-content: flex-start;
    gap: 0.48rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .compact-combobox-option-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.82rem;
    height: 0.82rem;
    flex: 0 0 auto;
    border-radius: var(--ui-radius-xs);
    background: color-mix(in oklab, var(--ui-surface-muted) 70%, transparent);
    color: var(--ui-text-secondary);
  }

  .compact-combobox-option-check.checked {
    background: color-mix(in oklab, var(--ui-accent-soft) 34%, var(--ui-surface-muted));
    color: var(--ui-text-primary);
  }

  .compact-combobox-option.active {
    background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
    color: var(--ui-text-primary);
  }

  .compact-combobox-option.focused:not(:disabled),
  .compact-combobox-option:hover:not(:disabled),
  .compact-combobox-option:focus-visible:not(:disabled) {
    outline: none;
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .compact-combobox-option:disabled {
    color: var(--ui-text-tertiary);
    cursor: default;
    opacity: 1;
  }

  .compact-combobox-option span,
  .compact-combobox-empty {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compact-combobox-empty {
    padding: 0.48rem 0.56rem;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  @media (prefers-reduced-motion: reduce) {
    .compact-combobox-caret {
      transition: none;
    }
  }
</style>
