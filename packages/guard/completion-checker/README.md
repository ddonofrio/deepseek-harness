# @deepseek-ai/dsh-completion-checker

English | [中文](README.zh.md)

The completion checker exposes a model-visible `completion_check` tool. Before giving a final answer, the agent must call it; the tool runs a fresh one-shot reviewer, returns the reviewer's feedback to the parent, and lets the parent continue in the same turn when work remains. Its default setting is enabled.

## Configuration

```yaml
- id: completion-checker
  name: '@deepseek-ai/dsh-completion-checker'
  config:
    enabled: true
    provider: spawn
```

The `enabled` field is also available in the `completion-checker` General settings namespace and applies live. `provider` names a registered one-shot `ctx.subagents` provider. The shipped `spawn` provider is required by the default composition because the checker gives it a clean transcript instead of inherited history.

## Review protocol

The reviewer returns its ordinary final response as feedback for the parent agent. It does not need to call a reporting tool or match a structured schema.

The `completion_check` tool wraps that response as `{ "review": "..." }` for the parent model.

The parent calls `completion_check` after completing the requested work. The tool starts the reviewer, waits for its ordinary response, disposes the reviewer, and returns the feedback visibly to the parent. The parent must read it, address every requested change, and call the tool again after making changes. A reviewer response is never rejected for its wording or format; provider failures are returned as feedback so the parent can decide how to proceed.

The reviewer's child is a visible one-shot subagent and is disposed before the tool returns. It appears in subagent/session listings while it runs and its completed transcript remains inspectable when persistence is enabled. The reviewer cannot call `completion_check`; the tool is removed from its scoped tool view and nested agents are excluded from the top-level completion policy, so validation cannot recurse. Loop detection is enabled inside the reviewer using the parent's loop policy, with the reviewer-specific loop detector enabled. The reviewer inherits the parent's other available tools and is instructed to use them for verification when needed.

## Model Experience

### Completion review

#### What the model sees

The reviewer receives a clean chronological transcript of every user-visible turn: direct user messages, assistant text, tool calls with compact arguments, failed tool results, and todos. It does not receive inherited history, model reasoning, runtime-context messages, session events, usage data, or raw tool payloads and results. The reviewer can use its tools when verification requires omitted details. The parent transcript shows the `completion_check` tool call and its pending/result states while the reviewer runs.

#### Token effect

Each `completion_check` call adds one reviewer model request. Feedback that requires changes adds another parent step, which normally ends with another `completion_check` call.

#### KV Cache effect

The reviewer is a separate subagent request. The parent agent's cached context is not extended with the reviewer's private reasoning; only the tool call/result and any requested continuation remain in the parent transcript.

## Known Limitations and Deferred Work

- The checker does not guarantee correctness: it adds an independent model review and gives its feedback to the parent agent.
- A provider failure is fail-open for the parent turn, so a missing or unavailable review cannot block the user's answer after the provider has been configured.
