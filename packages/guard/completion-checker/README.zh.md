# @deepseek-ai/dsh-completion-checker

[English](README.md) | 中文

completion checker 会在普通轮次完成、轮次关闭之前，使用一次性的 `fork` 子 agent 复核结果。复核器继承已经关闭的对话历史，并收到当前尚未关闭轮次的 JSON 事件记录，因此可以检查用户请求、agent 已完成的工作、工具结果和最终回答。默认设置为开启。

## 配置

```yaml
- id: completion-checker
  name: '@deepseek-ai/dsh-completion-checker'
  config:
    enabled: true
    provider: fork
```

`enabled` 也可在 General 设置中的 `completion-checker` namespace 修改，并且立即生效。`provider` 指向已注册的一次性 `ctx.subagents` 提供方，必须支持结构化输出。默认组合要求使用 `fork`，因为复核需要父 agent 的对话。

## 复核协议

复核器返回只有以下字段的结构化值：

```json
{"status":"complete|incomplete","message":""}
```

每次复核开始前，父对话都会显示 `Double-checking results before stopping…` 通知。`complete` 且 message 为空时，当前轮次可以关闭。`incomplete` 必须包含非空且可执行的 `message`；checker 会把文本作为插件来源的 user message 发送给父 agent，并引导它再执行一个模型步骤。复核失败或结果无效时，保留原回答并记录 warning。

复核器是一次性子 agent，结果结算后会被释放。checker 不会递归复核复核器或其创建的子 agent。复核器继承父 agent 可用的工具，并在需要时使用这些工具进行验证。

## Model Experience

### 完成度复核

#### What the model sees

复核器会收到继承的对话，以及当前轮次的 JSON 事件记录，并且必须返回 `{status, message}` 结构化结果。复核提示要求它检查用户请求、已完成的工作、工具结果和最终回答；需要验证时可以使用继承的工具。复核请求运行期间，父对话会显示 `Double-checking results before stopping…` 通知。

#### Token effect

每个已完成的父轮次都会增加一次复核器模型请求。如果结果为 `incomplete`，父 agent 还会增加一次继续执行的请求。

#### KV Cache effect

复核器使用独立的子 agent 请求。父 agent 的缓存上下文不会加入复核提示或复核器的私有推理；状态通知以及需要时的不完整复核都会作为插件来源的继续上下文持久化。

## 已知限制和后续工作

- checker 不保证正确性：它增加一次独立的模型复核，只有复核报告 `incomplete` 时才会继续。
- 提供方失败对父轮次采用 fail-open，因此配置提供方后，复核不可用不会阻塞用户回答。
