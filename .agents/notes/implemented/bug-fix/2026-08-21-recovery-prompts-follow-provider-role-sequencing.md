# Agent Note: Recovery prompts follow provider role sequencing

Status: implemented

English | [中文](2026-08-21-recovery-prompts-follow-provider-role-sequencing.zh.md)

This note supersedes the recovery-producer role described in [Recovery prompts use the agent conversation role](2026-08-21-recovery-prompts-use-agent-role.md).

## Problem

Loop-detection and output-token recovery prompts were projected as assistant messages after the partial assistant response that triggered recovery. Providers that reject consecutive assistant messages failed the next request before generation.

## Decision

The loop detector and token-limit handler keep recovery prompts as ordinary user-role `user/message` events. Their plugin sources still identify the producer and the `notice` form still describes the message for durable consumers. The prompts remain model-visible and reconstructable without placing two assistant messages at the end of a request.

The optional `modelRole: 'assistant'` source marker remains available for plugin messages that explicitly require assistant presentation. Recovery handlers do not use it because their prompts follow model output and must satisfy provider role sequencing.

## Alternatives considered

**Keep recovery prompts as assistant messages.** Rejected because a partial or completed assistant response already precedes each recovery prompt, and providers such as `llama-server` reject that request sequence.

**Merge the recovery prompt into the preceding assistant message.** Rejected because it would change the durable message projection and present an agent instruction as model-authored output.

**Normalize adjacent assistant messages inside each provider adapter.** Rejected because recovery sequencing is shared agent behavior; provider-specific normalization would make request reconstruction and provider behavior diverge.

## Consequences

Every loop-detection and output-token recovery request ends with a user-role intervention instead of consecutive assistant messages. Durable input ownership, source attribution, persistence, and replay remain unchanged. The model still receives the configured recovery text at the next step, while providers with strict role sequencing can accept the request.

Focused agent-loop and token-limit-handler tests assert the user-role recovery and reject adjacent assistant messages in the loop recovery transcript.
