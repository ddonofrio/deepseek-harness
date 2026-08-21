# @deepseek-ai/dsh-completion-checker

English | [中文](README.zh.md)

The completion checker exposes a model-visible `completion_check` tool. Before giving a final answer, the agent must call it; the tool runs a one-shot `fork` reviewer, returns its verdict to the parent, and lets the parent continue in the same turn when work remains. Its default setting is enabled.

## Configuration

```yaml
- id: completion-checker
  name: '@deepseek-ai/dsh-completion-checker'
  config:
    enabled: true
    provider: fork
    maxAttempts: 2
```

The `enabled` field is also available in the `completion-checker` General settings namespace and applies live. `provider` names a registered one-shot `ctx.subagents` provider and must support structured output. `maxAttempts` bounds protocol recovery when a reviewer finishes without emitting structured output; it defaults to `2` and is capped at `3`. The shipped `fork` provider is required by the default composition because the review needs the parent's conversation.

## Review protocol

The reviewer returns a structured value with exactly these fields:

```json
{"status":"complete|incomplete|unavailable","message":""}
```

The parent calls `completion_check` after completing the requested work. The tool starts the reviewer with structured output, waits for its result, disposes the reviewer, and then returns a visible verdict: `complete` reports `Completion check passed. The request is complete.`; `incomplete` reports the requested changes to the parent. The parent must address those changes and call the tool again before replying. If the reviewer omits structured output, the checker starts a bounded recovery attempt with a stricter protocol instruction; every failed attempt is disposed before the next one. After the retry budget, `unavailable` reports that no valid review was obtained and fails open without asking the parent to repeat the same broken call. A later call in the same turn returns the same `unavailable` result without starting another reviewer.

The reviewer's child is a visible one-shot subagent and is disposed before the tool returns. It appears in subagent/session listings while it runs and its completed transcript remains inspectable when persistence is enabled. The reviewer cannot call `completion_check`; the tool is removed from its scoped tool view and nested agents are excluded from the top-level completion policy, so validation cannot recurse. The reviewer inherits the parent's other available tools and is instructed to use them for verification when needed.

## Model Experience

### Completion review

#### What the model sees

The current-turn event summary is bounded and large message or tool-result blocks are truncated before they reach the reviewer prompt. The reviewer receives the inherited conversation plus a JSON event log for the current turn, and must return the structured result `{status, message}`. The review prompt asks it to inspect the request, completed work, tool results, and answer draft, using its inherited tools when verification requires them. The parent transcript shows the `completion_check` tool call and its pending/result states while the reviewer runs.

#### Token effect

Each `completion_check` call adds one reviewer model request. An incomplete result adds another parent step, which normally ends with another `completion_check` call.

#### KV Cache effect

The reviewer is a separate subagent request. The parent agent's cached context is not extended with the reviewer's private reasoning; only the tool call/result and any requested continuation remain in the parent transcript.

## Known Limitations and Deferred Work

- The checker does not guarantee correctness: it adds an independent model review and only continues when that review reports `incomplete`.
- A provider failure is fail-open for the parent turn, so a missing or unavailable review cannot block the user's answer after the provider has been configured.
