# Agent Note: Completion review before turn close

Status: implemented

English | [中文](2026-08-21-completion-review-before-turn-close.zh.md)

## Problem

An agent can stop after producing a plausible answer while leaving a requested verification, edit, or follow-up unfinished. The terminal turn checkpoint already permits policy plugins to steer another step, but no policy independently reviews the completed work.

## Decision

`@deepseek-ai/dsh-completion-checker` listens to `agent/turn-stopping` for normal completed turns and starts a one-shot `fork` subagent with structured output. The fork inherits the closed conversation prefix and receives the current turn's event log in its review prompt, because the current turn has not yet appended `turn/end` at the checkpoint.

The review protocol is `{ status: 'complete' | 'incomplete'; message: string }`. The plugin first records a visible `Double-checking results before stopping…` plugin notice so the parent UI shows the review interval. An incomplete result must contain an actionable message; the plugin records that message as a plugin-sourced `user/message` and calls `agent.steer()` before the turn closes. Complete, invalid, failed, aborted, and non-completed reviews leave the original terminal decision unchanged. The reviewer run is disposed after settlement, and an active-agent set prevents recursive reviews.

The `completion-checker` settings namespace exposes `enabled`, defaults it to `true`, and applies it live. The provider name remains composition configuration and defaults to `fork`, which is mounted by the base bundle.

## Alternatives considered

**Wait for `turn/end` and then start the review.** Rejected because the post-boundary event cannot synchronously participate in the current turn's close decision; an incomplete review would need a separate wake-up policy and could race user input.

**Use the ordinary fresh `spawn` provider.** Rejected because a fresh child cannot inspect the inherited conversation without duplicating the complete history in the prompt; the fork provider preserves the parent context and the current-turn supplement only covers the not-yet-closed suffix.

**Parse a free-form reviewer answer.** Rejected because completion status and the continuation message are model-visible control data; the structured-output protocol makes malformed decisions fail open instead of steering on ambiguous text.

## Consequences

The user may see one additional agent step when the reviewer finds missing work, while the review itself remains a child activity rather than a second assistant answer in the parent transcript. Review failures do not block a response, so the feature improves completeness opportunistically and does not become a new provider availability requirement after composition succeeds.

The reviewer inherits the parent's tools and may use them to verify claims. Recursive checking is suppressed by tracking the parent and reviewer agent identities in memory; this state is intentionally not durable because it coordinates one live terminal checkpoint only.
