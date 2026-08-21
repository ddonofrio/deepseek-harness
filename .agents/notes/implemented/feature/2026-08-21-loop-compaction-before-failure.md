# Agent Note: Compact loop context before terminal failure

Status: implemented

English | [中文](2026-08-21-loop-compaction-before-failure.zh.md)

## Problem

Repeated model output can remain stable after three intervention prompts because the retained conversation contains the context that led to the loop. Recovery must compact the completed conversation and retry the original input from a new turn; compacting inside the active step does not provide the same lifecycle as an explicit `/compact` command.

## Decision

`LoopDetectionOptions.compactBeforeFailing` and the General setting `loopDetectionCompactBeforeFailing` default to `false`. When enabled, the fourth consecutive detection saves the messages claimed for the turn, ends that turn with the loop failure, and defers recovery until the driver is idle. The agent then invokes the compaction provider's `compactNow` path, which is the same idle maintenance operation used by `/compact`; waking input remains queued until it settles. A non-null result puts the saved messages at the front of `next-turn`, starting a fresh turn and resetting the consecutive loop counter when the original user input is claimed. Missing compaction, a `null` result, or a backend error does not fabricate recovery and leaves the loop failure or backend failure terminal.

The compaction seam still names `loop-detection` separately from pressure and provider-confirmed context overflow for direct automatic policy. This recovery path intentionally uses `compactNow` instead, because it must share the idle-session lifecycle of the explicit command.

## Alternatives considered

**Reuse the `context-overflow` trigger.** Rejected because loop detection is not provider-confirmed context overflow; a distinct trigger keeps backend policy and telemetry truthful.

**Queue a new intervention prompt after compacting.** Rejected because the recovery must replay the request that produced the loop against the compacted surface; adding another prompt would change the request instead of removing the context that caused the repeated output.

**Compact inside the active turn.** Rejected because `compactIfNeeded` runs under current-turn ownership and does not provide the idle maintenance lifecycle or fresh turn boundary of `/compact`.

**Make compaction mandatory when the option is enabled.** Rejected because compaction is an optional service and some deployments have no safe range or no compaction backend; those deployments retain the existing terminal error.

## Verification

Agent-loop tests cover idle `compactNow` recovery, original-input replay in a new turn, counter reset, no useful range, and no installed provider. Settings tests cover the General field and its projection into new agents. Compaction service tests and the basic backend's switch cover the `loop-detection` trigger independently.

## Consequences

An enabled deployment can perform repeated idle-compaction-and-new-turn cycles if each backend call produces a replacement, so the option intentionally has no additional loop cap. Every successful compaction remains durable through the existing compaction events, and the retried input is logged as a new turn after the checkpoint.
