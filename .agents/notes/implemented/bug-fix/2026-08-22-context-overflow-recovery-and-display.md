# Agent Note: Context overflow recovery and safe display

Status: implemented

English | [中文](2026-08-22-context-overflow-recovery-and-display.zh.md)

## Problem

Provider responses can report that the complete request is larger than the model context window even when the serial pre-step pressure check did not see the current user input. The provider wording is not uniform, and projecting that diagnostic directly into client state exposes an implementation detail instead of a useful recovery message.

## Decision

The AgentLoop performs the existing pressure policy again after the current step input and request header are durable but before dispatching the frozen request. If compaction changes the session, the request is rebuilt. Provider adapters classify measured message-size context errors as `CONTEXT_WINDOW_EXCEEDED`, so the existing bounded overflow-compaction retry remains available. Client projections select a safe localized message from that stable code and do not display the provider diagnostic.

## Alternatives considered

- **Require an exact provider tokenizer for preflight:** Not selected because the shared LLM seam does not provide one; the existing token-meter policy and provider response remain the available signals.
- **Drop arbitrary history or the current prompt:** Not selected because compaction must preserve model-visible content and balanced tool-call units.
- **Change only the client text:** Not selected because an unclassified overflow would still bypass the recovery path.

## Consequences

Requests near the context limit may perform one additional pressure check and compaction before dispatch. The heuristic preflight does not replace provider-authoritative overflow handling, so adapters still normalize the provider response and the loop retains its bounded retry. Client-visible failures remain actionable and free of raw provider context-limit wording.
