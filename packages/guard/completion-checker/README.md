# @deepseek-ai/dsh-completion-checker

English | [中文](README.zh.md)

The completion checker reviews a normal completed turn with a one-shot `fork` subagent before the turn closes. The reviewer inherits closed conversation history and receives the still-open turn as a JSON event log, so it can inspect the user's request, the agent's work, tool results, and the final answer. Its default setting is enabled.

## Configuration

```yaml
- id: completion-checker
  name: '@deepseek-ai/dsh-completion-checker'
  config:
    enabled: true
    provider: fork
```

The `enabled` field is also available in the `completion-checker` General settings namespace and applies live. `provider` names a registered one-shot `ctx.subagents` provider and must support structured output. The shipped `fork` provider is required by the default composition because the review needs the parent's conversation.

## Review protocol

The reviewer returns a structured value with exactly these fields:

```json
{"status":"complete|incomplete","message":""}
```

Before each review, the parent receives a visible `Double-checking results before stopping…` notice. `complete` with an empty message allows the current turn to close. `incomplete` requires a non-empty actionable `message`; the checker sends that text to the parent as a plugin-sourced user message and steers one more model step. A review failure or invalid result leaves the original answer in place and logs a warning.

The reviewer's child is one-shot and is disposed after its result settles. The checker does not recursively review the reviewer or a child it has spawned. The reviewer inherits the parent's available tools and is instructed to use them for verification when needed.

## Model Experience

### Completion review

#### What the model sees

The reviewer receives the inherited conversation plus a JSON event log for the current turn, and must return the structured result `{status, message}`. The review prompt asks it to inspect the request, completed work, tool results, and final answer, using its inherited tools when verification requires them. The parent transcript shows a `Double-checking results before stopping…` notice while this request runs.

#### Token effect

Each completed parent turn adds one reviewer model request. An incomplete result adds one continuation request for the parent agent.

#### KV Cache effect

The reviewer is a separate subagent request. The parent agent's cached context is not extended with the review prompt or the reviewer's private reasoning; the status notice and, when needed, an incomplete review are logged as plugin-sourced continuation context.

## Known Limitations and Deferred Work

- The checker does not guarantee correctness: it adds an independent model review and only continues when that review reports `incomplete`.
- A provider failure is fail-open for the parent turn, so a missing or unavailable review cannot block the user's answer after the provider has been configured.
