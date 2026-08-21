# Agent Note: Completion review before turn close

Status: implemented

English | [中文](2026-08-21-completion-review-before-turn-close.zh.md)

## Problem

An agent can stop after producing a plausible answer while leaving a requested verification, edit, or follow-up unfinished. The terminal turn checkpoint already permits policy plugins to steer another step, but no policy independently reviews the completed work.

## Decision

`@deepseek-ai/dsh-completion-checker` registers a model-visible `completion_check` tool. The tool starts a one-shot `fork` subagent with structured output inside the parent model step. The fork inherits the closed conversation prefix and receives the current turn's event log in its review prompt. The terminal listener no longer starts a child; it only requires a check before an unchecked completed turn can close and requires another check after an incomplete result.

The review protocol is `{ status: 'complete' | 'incomplete' | 'unavailable'; message: string }`. Before a final answer, the parent calls `completion_check`; the tool waits for the structured reviewer result, disposes the reviewer, and returns a visible verdict. `complete` shows that the request is complete, while `incomplete` returns the requested changes to the parent, which must address them and call the tool again. If structured output is missing, the checker retries with a stricter protocol instruction up to the configured bounded attempt limit, disposing each failed run before retrying. After that limit, `unavailable` reports the failure and fails open for the current turn; later calls in that turn reuse the result instead of starting another reviewer loop. The reviewer is a visible one-shot child so it appears in subagent listings while running and remains inspectable when persistence is enabled; it is disposed before the tool returns. Nested agents cannot invoke the checker, so validation cannot recurse.

The `completion-checker` settings namespace exposes `enabled`, defaults it to `true`, and applies it live. The provider name and bounded `maxAttempts` retry budget remain composition configuration; they default to `fork` and `2`, respectively. The base bundle mounts the `fork` provider.

## Alternatives considered

**Start the review from `agent/turn-stopping`.** Rejected because the terminal checkpoint is an awaited hidden side effect: a provider or child lifecycle delay can leave the parent showing a checking notice without a visible model request. A model-visible tool call keeps the review inside an observable model step and gives the tool result to the parent directly.

**Use the ordinary fresh `spawn` provider.** Rejected because a fresh child cannot inspect the inherited conversation without duplicating the complete history in the prompt; the fork provider preserves the parent context and the current-turn supplement only covers the not-yet-closed suffix.

**Parse a free-form reviewer answer.** Rejected because completion status and the continuation message are model-visible control data; the structured-output protocol makes malformed decisions fail open instead of steering on ambiguous text.

## Consequences

The user sees the `completion_check` tool call and its pending/result lifecycle, while the review remains a child activity rather than a second assistant answer in the parent transcript. An incomplete result makes the parent continue and repeat the tool call after its changes. Review failures do not block a response, so the feature improves completeness opportunistically and does not become a new provider availability requirement after composition succeeds.

The reviewer inherits the parent's tools and may use them to verify claims, except for `completion_check`, which is removed from its scoped tool view. Nested agents do not receive the completion policy and the terminal guard ignores them, so validation cannot recurse. The terminal guard keeps only the latest review status per live parent and does not persist that coordination state.

The current-turn supplement is a bounded event summary rather than a lossless log, so large tool results cannot exhaust the reviewer's context. Only the agent-loop's automatic compaction notice is excluded from completion review; the third loop-retry prompt is reviewed after the model answers it.
