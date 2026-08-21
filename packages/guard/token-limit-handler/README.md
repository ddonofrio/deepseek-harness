# @deepseek-ai/dsh-token-limit-handler

English | [中文](README.zh.md)

The token-limit handler responds at the `agent/turn-stopping` extension point when a model step ends with `max-tokens`. Its default policy sends `continue` up to five consecutive times in the same recovery chain. `stop` leaves the turn at the existing terminal boundary, and `custom-prompt` sends the configured text instead. A non-`max-tokens` turn ending resets the chain.

## Configuration

```yaml
- id: token-limit-handler
  name: '@deepseek-ai/dsh-token-limit-handler'
  config:
    action: continue       # stop | continue | custom-prompt
    continueCount: 5       # positive safe integer
    customPrompt: ''       # required when action is custom-prompt
```

The same fields are available in the `token-limit-handler` settings namespace and are applied live. An empty `customPrompt` is rejected when `action` is `custom-prompt`. Each recovery prompt is logged as a plugin-sourced `user/message`, then projected to the model as an `assistant` message so the model treats it as agent continuation rather than a new human request.

## Model Experience

### Output-token recovery prompt

#### What the model sees

The default continuation is the user message `continue`. A custom action sends the configured prompt verbatim.

#### Token effect

Each recovery is retained conversation input. The default policy adds at most five recovery messages for one consecutive chain.

#### KV Cache effect

Append-only; each recovery adds a new message after the existing request history.

## Known Limitations and Deferred Work

- **One live chain per agent** — the continuation count is in memory and resets when a non-`max-tokens` turn ending occurs or the handler is unloaded; it is not restored from persisted history.
- **No partial-response editing** — the handler preserves the truncated assistant message and adds a follow-up prompt; it does not merge model responses.
