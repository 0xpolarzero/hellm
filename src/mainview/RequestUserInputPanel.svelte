<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import PlayIcon from "@lucide/svelte/icons/play";
  import SendIcon from "@lucide/svelte/icons/send-horizontal";
  import { onMount } from "svelte";
  import type {
    RequestUserInputAnswerRequest,
    SetRequestUserInputTimerPausedRequest,
    WorkspaceRequestUserInputQuestion,
    WorkspaceRequestUserInputRequest,
  } from "../shared/workspace-contract";
  import Button from "./ui/Button.svelte";
  import TextArea from "./ui/TextArea.svelte";
  import Tooltip from "./ui/Tooltip.svelte";
  import {
    countOpenRequestUserInputQuestions,
    countRequestUserInputQuestions,
    getFirstOpenRequestUserInputQuestionKey,
    getRequestUserInputQuestionKey,
    groupRequestUserInputRequests,
    isRequestUserInputQuestionOpen,
    type RequestUserInputQuestionKey,
  } from "./request-user-input-panel";

  type Props = {
    requests: WorkspaceRequestUserInputRequest[];
    onAnswer: (request: RequestUserInputAnswerRequest) => Promise<void> | void;
    onSetTimerPaused?: (request: SetRequestUserInputTimerPausedRequest) => Promise<void> | void;
    onOpenOwner?: (request: WorkspaceRequestUserInputRequest) => void;
  };

  let { requests, onAnswer, onSetTimerPaused, onOpenOwner }: Props = $props();
  let expandedKeys = $state<Record<string, boolean>>({});
  let customAnswers = $state<Record<string, string>>({});
  let pendingKey = $state<string | null>(null);
  let pendingTimerRequestId = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let nowMs = $state(Date.now());
  let autoPausedKeys = $state<Record<string, boolean>>({});

  const ownerGroups = $derived(groupRequestUserInputRequests(requests));
  const defaultExpandedKey = $derived(getFirstOpenRequestUserInputQuestionKey(requests));
  const questionCount = $derived(countRequestUserInputQuestions(requests));

  function isExpanded(key: RequestUserInputQuestionKey, question: WorkspaceRequestUserInputQuestion): boolean {
    const explicit = expandedKeys[key];
    if (typeof explicit === "boolean") {
      return explicit;
    }
    return question.status === "open" && key === defaultExpandedKey;
  }

  function toggleQuestion(key: RequestUserInputQuestionKey, question: WorkspaceRequestUserInputQuestion): void {
    expandedKeys = {
      ...expandedKeys,
      [key]: !isExpanded(key, question),
    };
  }

  function formatTimerDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
  }

  function timerLabel(request: WorkspaceRequestUserInputRequest): string | null {
    const timeout = request.timeout;
    if (request.variant !== "blocking" || request.status !== "open") return null;
    if (!timeout?.enabled) return "No timeout";
    if (timeout.pausedAt) {
      return `Paused with ${formatTimerDuration(timeout.remainingMsWhenPaused ?? 0)} left`;
    }
    if (!timeout.expiresAt) return null;
    return `${formatTimerDuration(Date.parse(timeout.expiresAt) - nowMs)} left`;
  }

  async function setTimerPaused(request: WorkspaceRequestUserInputRequest, paused: boolean): Promise<void> {
    if (!onSetTimerPaused || pendingTimerRequestId || !request.timeout?.enabled) {
      return;
    }
    pendingTimerRequestId = request.requestId;
    errorMessage = null;
    try {
      await onSetTimerPaused({
        surfacePiSessionId: request.surfacePiSessionId,
        requestId: request.requestId,
        paused,
      });
      if (!paused) {
        autoPausedKeys = Object.fromEntries(
          Object.entries(autoPausedKeys).filter(([key]) => !key.startsWith(`${request.requestId}:`)),
        );
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to update timer.";
    } finally {
      pendingTimerRequestId = null;
    }
  }

  function updateCustomAnswer(
    event: Event,
    request: WorkspaceRequestUserInputRequest,
    question: WorkspaceRequestUserInputQuestion,
  ): void {
    const key = getRequestUserInputQuestionKey(request.requestId, question.questionId);
    const text = (event.currentTarget as HTMLTextAreaElement).value;
    customAnswers = {
      ...customAnswers,
      [key]: text,
    };
    if (
      text.trim() &&
      request.variant === "blocking" &&
      request.status === "open" &&
      request.timeout?.enabled &&
      !request.timeout.pausedAt &&
      pendingTimerRequestId !== request.requestId &&
      !autoPausedKeys[key]
    ) {
      autoPausedKeys = { ...autoPausedKeys, [key]: true };
      void setTimerPaused(request, true);
    }
  }

  async function answerQuestion(
    request: WorkspaceRequestUserInputRequest,
    question: WorkspaceRequestUserInputQuestion,
    answer: RequestUserInputAnswerRequest["answer"],
    delivery: RequestUserInputAnswerRequest["delivery"],
  ): Promise<void> {
    if (!isRequestUserInputQuestionOpen(question) || pendingKey) {
      return;
    }
    const key = getRequestUserInputQuestionKey(request.requestId, question.questionId);
    pendingKey = key;
    errorMessage = null;
    try {
      await onAnswer({
        surfacePiSessionId: request.surfacePiSessionId,
        requestId: request.requestId,
        questionId: question.questionId,
        answer,
        delivery,
      });
      expandedKeys = { ...expandedKeys, [key]: false };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to queue answer.";
    } finally {
      pendingKey = null;
    }
  }

  function submitCustomAnswer(
    request: WorkspaceRequestUserInputRequest,
    question: WorkspaceRequestUserInputQuestion,
    delivery: RequestUserInputAnswerRequest["delivery"],
  ): void {
    const key = getRequestUserInputQuestionKey(request.requestId, question.questionId);
    const text = customAnswers[key]?.trim() ?? "";
    if (!text) {
      errorMessage = "Custom answer cannot be empty.";
      return;
    }
    void answerQuestion(request, question, { kind: "custom", text }, delivery);
  }

  function handleCustomKeydown(
    event: KeyboardEvent,
    request: WorkspaceRequestUserInputRequest,
    question: WorkspaceRequestUserInputQuestion,
  ): void {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    submitCustomAnswer(
      request,
      question,
      event.metaKey || event.ctrlKey ? "queue-only" : "enqueue-and-run",
    );
  }

  onMount(() => {
    const interval = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });
</script>

<aside class="request-user-input-panel" aria-label="Clarification requests">
  <header class="request-user-input-header">
    <div>
      <p class="request-user-input-kicker">Questions</p>
      <h2>Clarifications</h2>
    </div>
    <span class="request-user-input-count">{questionCount}</span>
  </header>

  {#if errorMessage}
    <p class="request-user-input-error" role="alert">{errorMessage}</p>
  {/if}

  <div class="request-user-input-groups">
    {#each ownerGroups as group (group.surfacePiSessionId)}
      {@const openCount = countOpenRequestUserInputQuestions(group.requests)}
      <section class="request-user-input-group">
        <button
          class="request-user-input-owner"
          type="button"
          onclick={() => onOpenOwner?.(group.requests[0]!)}
        >
          <span>{group.ownerTitle}</span>
          <small>{openCount > 0 ? `${openCount} open` : "answered"}</small>
        </button>

        {#each group.requests as request (request.requestId)}
          {#each request.questions as question (question.questionId)}
            {@const key = getRequestUserInputQuestionKey(request.requestId, question.questionId)}
            {@const expanded = isExpanded(key, question)}
            {@const answerable = isRequestUserInputQuestionOpen(question)}
            {@const requestTimerLabel = timerLabel(request)}
            <article class={`request-user-input-card ${expanded ? "expanded" : ""} ${answerable ? "answerable" : "answered"}`.trim()}>
              <button
                class="request-user-input-card-toggle"
                type="button"
                aria-expanded={expanded}
                onclick={() => toggleQuestion(key, question)}
              >
                <span class="request-user-input-card-title">
                  {#if expanded}
                    <ChevronDownIcon aria-hidden="true" size={14} />
                  {:else}
                    <ChevronRightIcon aria-hidden="true" size={14} />
                  {/if}
                  <span>{question.title}</span>
                </span>
                {#if answerable}
                  <span class="request-user-input-card-state">Open</span>
                {:else}
                  <span class="request-user-input-card-state answered">
                    <CheckIcon aria-hidden="true" size={12} />
                    Answered
                  </span>
                {/if}
              </button>

              {#if expanded}
                <div class="request-user-input-card-body">
                  <p class="request-user-input-question">{question.question}</p>
                  {#if requestTimerLabel}
                    <div class="request-user-input-timer">
                      <span>
                        <ClockIcon aria-hidden="true" size={13} />
                        {requestTimerLabel}
                      </span>
                      {#if request.timeout?.enabled}
                        <Button
                          size="xs"
                          variant="ghost"
                          iconOnly
                          aria-label={request.timeout.pausedAt ? "Resume timer" : "Pause timer"}
                          disabled={pendingTimerRequestId === request.requestId}
                          onclick={() => void setTimerPaused(request, !request.timeout?.pausedAt)}
                        >
                          {#if request.timeout.pausedAt}
                            <PlayIcon aria-hidden="true" size={13} />
                          {:else}
                            <PauseIcon aria-hidden="true" size={13} />
                          {/if}
                        </Button>
                      {/if}
                    </div>
                  {/if}

                  {#if question.choices.length > 0}
                    <div class="request-user-input-options">
                      {#each question.choices as option (option.optionId)}
                        <div class="request-user-input-option">
                          <div class="request-user-input-option-copy">
                            <div class="request-user-input-option-title">
                              <span>{option.label}</span>
                              {#if option.recommended}
                                <em>Default</em>
                              {/if}
                            </div>
                            <p>{option.description}</p>
                          </div>
                          <div class="request-user-input-option-actions">
                            <Tooltip label="Queue immediately" side="top">
                              <Button
                                size="xs"
                                iconOnly
                                aria-label={`Queue ${option.label} immediately`}
                                disabled={!answerable || pendingKey === key}
                                onclick={() =>
                                  void answerQuestion(
                                    request,
                                    question,
                                    { kind: "option", optionId: option.optionId },
                                    "enqueue-and-run",
                                  )}
                              >
                                <SendIcon aria-hidden="true" size={13} />
                              </Button>
                            </Tooltip>
                            <Tooltip label="Queue after current turn" side="top">
                              <Button
                                size="xs"
                                variant="ghost"
                                iconOnly
                                aria-label={`Queue ${option.label} after the current turn`}
                                disabled={!answerable || pendingKey === key}
                                onclick={() =>
                                  void answerQuestion(
                                    request,
                                    question,
                                    { kind: "option", optionId: option.optionId },
                                    "queue-only",
                                  )}
                              >
                                <ClockIcon aria-hidden="true" size={13} />
                              </Button>
                            </Tooltip>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}

                  <div class="request-user-input-custom">
                    <TextArea
                      resize="none"
                      aria-label={`Custom answer for ${question.title}`}
                      placeholder="Custom answer"
                      disabled={!answerable || pendingKey === key}
                      value={customAnswers[key] ?? ""}
                      oninput={(event) => updateCustomAnswer(event, request, question)}
                      onkeydown={(event) => handleCustomKeydown(event, request, question)}
                    />
                    <div class="request-user-input-custom-actions">
                      <Button
                        size="xs"
                        disabled={!answerable || pendingKey === key}
                        onclick={() => submitCustomAnswer(request, question, "enqueue-and-run")}
                      >
                        <SendIcon aria-hidden="true" size={13} />
                        Queue now
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!answerable || pendingKey === key}
                        onclick={() => submitCustomAnswer(request, question, "queue-only")}
                      >
                        <ClockIcon aria-hidden="true" size={13} />
                        After turn
                      </Button>
                    </div>
                  </div>
                </div>
              {/if}
            </article>
          {/each}
        {/each}
      </section>
    {/each}
  </div>
</aside>

<style>
  .request-user-input-panel {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--ui-shell-edge);
    background: var(--ui-chrome);
    color: var(--ui-text-primary);
  }

  .request-user-input-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
    min-height: var(--workspace-chrome-height);
    padding: 0 var(--space-sm);
    border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 62%, transparent);
  }

  .request-user-input-header h2,
  .request-user-input-kicker,
  .request-user-input-question,
  .request-user-input-option p,
  .request-user-input-error {
    margin: 0;
  }

  .request-user-input-header h2 {
    font-size: var(--text-sm);
    font-weight: 700;
    letter-spacing: 0;
  }

  .request-user-input-kicker {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .request-user-input-count {
    display: inline-grid;
    place-items: center;
    min-width: 1.35rem;
    height: 1.35rem;
    border: 1px solid color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border-soft));
    background: var(--ui-accent-soft);
    color: var(--ui-text-primary);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .request-user-input-error {
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid color-mix(in oklab, var(--ui-danger) 28%, var(--ui-border-soft));
    background: var(--ui-danger-soft);
    color: var(--ui-text-primary);
    font-size: var(--text-xs);
  }

  .request-user-input-groups {
    min-height: 0;
    overflow: auto;
    padding: var(--space-sm);
  }

  .request-user-input-group + .request-user-input-group {
    margin-top: var(--space-sm);
  }

  .request-user-input-owner {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
    padding: 0 0 0.42rem;
    border: 0;
    background: transparent;
    color: var(--ui-text-primary);
    text-align: left;
    cursor: pointer;
  }

  .request-user-input-owner span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .request-user-input-owner small {
    flex: 0 0 auto;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .request-user-input-card {
    border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
  }

  .request-user-input-card-toggle {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
    padding: 0.58rem 0;
    border: 0;
    background: transparent;
    color: var(--ui-text-primary);
    cursor: pointer;
  }

  .request-user-input-card-title {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 0.32rem;
    font-size: var(--text-sm);
    font-weight: 650;
  }

  .request-user-input-card-title span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .request-user-input-card-state {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.22rem;
    color: var(--ui-accent);
    font-size: var(--text-xs);
    font-weight: 650;
  }

  .request-user-input-card-state.answered {
    color: var(--ui-text-tertiary);
  }

  .request-user-input-card-body {
    display: grid;
    gap: var(--space-xs);
    padding-bottom: var(--space-sm);
  }

  .request-user-input-question {
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .request-user-input-options {
    display: grid;
    gap: 0.45rem;
  }

  .request-user-input-option {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-xs);
    align-items: start;
    padding: 0.52rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 72%, transparent);
  }

  .request-user-input-option-title {
    display: flex;
    align-items: center;
    gap: 0.38rem;
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .request-user-input-option-title em {
    color: var(--ui-accent);
    font-size: var(--text-xs);
    font-style: normal;
    font-weight: 700;
  }

  .request-user-input-option p {
    margin-top: 0.18rem;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    line-height: 1.35;
  }

  .request-user-input-option-actions,
  .request-user-input-custom-actions,
  .request-user-input-timer,
  .request-user-input-timer span {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
  }

  .request-user-input-timer {
    justify-content: space-between;
    padding: 0.38rem 0.48rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 70%, transparent);
    background: color-mix(in oklab, var(--ui-surface-muted) 50%, transparent);
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
  }

  .request-user-input-custom {
    display: grid;
    gap: 0.42rem;
  }

  .request-user-input-custom :global(.ui-textarea) {
    min-height: 4.4rem;
    font-size: var(--text-sm);
  }

  .request-user-input-custom-actions {
    justify-content: flex-end;
  }
</style>
