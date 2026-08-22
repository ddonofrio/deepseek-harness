# Agent Note: Completion review before turn close

Status: implemented

English | [中文](2026-08-21-completion-review-before-turn-close.zh.md)

## Problem

An agent can stop after producing a plausible answer while leaving a requested verification, edit, or follow-up unfinished. The terminal turn checkpoint already permits policy plugins to steer another step, but no policy independently reviews the completed work.

## Decision

`@deepseek-ai/dsh-completion-checker` registers a model-visible `completion_check` tool. The tool starts a visible one-shot `spawn` subagent inside the parent model step and returns the child's ordinary textual response as feedback. The child receives a clean chronological transcript of all user-visible parent turns: direct user messages, assistant text, tool calls with compact arguments, failed tool results, and todos. It excludes model reasoning, runtime context, session events, usage data, and raw tool payloads and results. Its loop detector is explicitly enabled using the parent's loop policy. The terminal listener no longer starts a child; it only requires a check before an unchecked completed turn can close.

The reviewer has no output schema. Before a final answer, the parent calls `completion_check`; the tool waits for the reviewer's ordinary response, disposes the reviewer, and returns `{ review: string }` as visible feedback. The parent must address that feedback and call the tool again after making changes. The reviewer is a visible one-shot child so it appears in subagent listings while running and remains inspectable when persistence is enabled; it is disposed before the tool returns. Nested agents cannot invoke the checker, so validation cannot recurse.

The `completion-checker` settings namespace exposes `enabled`, defaults it to `true`, and applies it live. The provider name remains composition configuration and defaults to `spawn`, which the base bundle mounts.

## Alternatives considered

**Start the review from `agent/turn-stopping`.** Rejected because the terminal checkpoint is an awaited hidden side effect: a provider or child lifecycle delay can leave the parent showing a checking notice without a visible model request. A model-visible tool call keeps the review inside an observable model step and gives the tool result to the parent directly.

**Use the `fork` provider.** Rejected because its inherited parent history includes model and runtime data that does not help completion review. The fresh child receives the full clean transcript instead.

**Require structured reviewer output.** Rejected because the reviewer response is feedback for the parent agent, not a machine-enforced verdict. The parent reads the response and decides which requested changes to apply.

## Consequences

The user sees the `completion_check` tool call and its pending/result lifecycle, while the review remains a child activity rather than a second assistant answer in the parent transcript. Feedback that requires changes makes the parent continue and repeat the tool call after those changes. Review failures do not block a response, so the feature improves completeness opportunistically and does not become a new provider availability requirement after composition succeeds.

The reviewer inherits the parent's tools and may use them to verify claims, except for `completion_check`, which is removed from its scoped tool view. Nested agents do not receive the completion policy and the terminal guard ignores them, so validation cannot recurse. The reviewer runs the agent loop detector with its inherited policy and an enabled flag. The terminal guard keeps only the latest feedback per live parent and does not persist that coordination state.

The clean transcript carries all user-visible turns, so the reviewer can evaluate work that spans earlier turns without receiving model or runtime internals. Tool payloads and successful result bodies remain excluded; the reviewer uses its inherited tools to inspect details when needed. Only the agent-loop's automatic compaction notice is excluded from completion review; the third loop-retry prompt is reviewed after the model answers it.
