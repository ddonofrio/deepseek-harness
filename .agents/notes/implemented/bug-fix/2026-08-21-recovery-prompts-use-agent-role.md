# Agent Note: Recovery prompts use the agent conversation role

Status: implemented

English | [中文](2026-08-21-recovery-prompts-use-agent-role.zh.md)

## Problem

Loop-detection and output-token recovery prompts are queued through the agent inbox as user-role messages, so the model can interpret an automatic continuation as a new human request.

## Decision

Recovery producers mark their internal messages with `modelRole: 'assistant'`, and the canonical session surface projection presents those durable `user/message` events to the model as `assistant` messages. Direct human prompts and other injected context remain user-role messages. The durable event type and source attribution remain unchanged so inbox ownership, transcript rendering, replay, and persistence continue to describe the producer that supplied the input.

The projection creates a frozen assistant-role copy with the original message identity, content, and source. This keeps the role conversion deterministic from the session log and applies consistently to every adapter request without coupling the session package to recovery plugin names.

## Alternatives considered

**Change the durable event to `assistant/message`.** Rejected because recovery prompts are agent inputs queued through `steer()` and are not model output; changing the event would alter transcript ownership, event validation, and the inbox API for a model-request presentation detail.

**Send recovery prompts as `system` messages.** Rejected because the provider-neutral history model and the pi-ai adapter do not preserve in-history system messages as a common wire role; the required behavior is that the agent owns the continuation, which is represented directly by `assistant`.

**Keep the prompts as `user` messages and add wording that they are automatic.** Rejected because wording cannot change the role semantics that caused the model to attribute the continuation to the human.

## Consequences

The model receives loop and token-limit recovery prompts as assistant-role messages, while the durable session and client transcript retain plugin-sourced user-message records. The shared source marker and projection own the rule, so both recovery plugins and future internal recovery producers use the same role without provider-specific branches or plugin-name checks in the session package.

Focused session, loop-detection, and token-limit-handler tests verify the role conversion, preserve human and ordinary plugin input as user messages, and cover reasoning and tool-call loop recovery.
