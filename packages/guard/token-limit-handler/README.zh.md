# @deepseek-ai/dsh-token-limit-handler

[English](README.md) | 中文

Token limit handler 在 `agent/turn-stopping` 扩展点处理以 `max-tokens` 结束的模型步骤。默认策略会在同一恢复链中连续发送最多五次 `continue`。`stop` 保持当前的终止行为；`custom-prompt` 发送配置的文本。非 `max-tokens` 的轮次结束会重置计数。

## 配置

```yaml
- id: token-limit-handler
  name: '@deepseek-ai/dsh-token-limit-handler'
  config:
    action: continue       # stop | continue | custom-prompt
    continueCount: 5       # positive safe integer
    customPrompt: ''       # required when action is custom-prompt
```

同样的字段通过 `token-limit-handler` 设置命名空间提供，并且实时生效。当 `action` 为 `custom-prompt` 时，空的 `customPrompt` 会被拒绝。每条恢复提示都会记录为插件来源的 `user/message`，随后在模型投影中作为 `assistant` 消息发送，使模型将其理解为 agent 的继续指令，而不是新的人工请求。

## 模型体验

### 输出 token 恢复提示

#### 模型看到的内容

默认继续提示是用户消息 `continue`。自定义操作会原样发送配置的提示词。

#### Token 影响

每次恢复都会成为保留的会话输入。默认策略对一个连续链最多添加五条恢复消息。

#### KV Cache 影响

只追加；每次恢复都会在已有请求历史后添加一条新消息。

## 已知限制和延期工作

- **每个 agent 只有一条实时链** —— 连续次数保存在内存中，在非 `max-tokens` 轮次结束或 handler 卸载时重置，不会从持久化历史恢复。
- **不会编辑部分响应** —— handler 会保留被截断的 assistant 消息并添加后续提示，不会合并模型响应。
