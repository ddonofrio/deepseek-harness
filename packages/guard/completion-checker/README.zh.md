# @deepseek-ai/dsh-completion-checker

[English](README.md) | 中文

completion checker 提供模型可见的 `completion_check` 工具。agent 在给出最终回答前必须调用它；该工具启动一次性的 `fork` 复核器，将 verdict 返回给父 agent，并在仍有工作时让父 agent 在同一轮继续。默认启用。

## 配置

```yaml
- id: completion-checker
  name: '@deepseek-ai/dsh-completion-checker'
  config:
    enabled: true
    provider: fork
    maxAttempts: 2
```

`enabled` 也可在 General 设置中的 `completion-checker` namespace 修改，并立即生效。`provider` 指向已注册的一次性 `ctx.subagents` 提供方，必须支持结构化输出。`maxAttempts` 限制复核器没有输出结构化结果时的协议恢复次数，默认值为 `2`，上限为 `3`。默认组合要求使用 `fork`，因为复核需要父 agent 的对话。

## 复核协议

复核器返回以下结构化值：

```json
{"status":"complete|incomplete|unavailable","message":""}
```

父 agent 完成请求工作后调用 `completion_check`。工具以结构化输出启动复核器，等待结果，释放复核器，然后返回可见 verdict：`complete` 返回 `Completion check passed. The request is complete.`；`incomplete` 将所需修改返回给父 agent。父 agent 必须完成这些修改，并在回答前再次调用工具。如果复核器没有输出结构化结果，checker 会用更严格的协议提示进行有限次恢复；每次失败尝试都会在下一次尝试前释放。达到重试上限后返回 `unavailable`，明确说明没有获得有效复核并对当前轮次 fail-open，不会要求父 agent 重复同一个失败调用。同一轮次的后续调用会复用 `unavailable` 结果，不再启动新的复核器。

复核器是可见的一次性子 agent，会在运行期间出现在 subagent/session 列表中；启用持久化时，完成后的 transcript 仍可检查。工具返回前会释放它。复核器的 scoped tools 中移除了 `completion_check`，嵌套 agent 也不参与顶层完成策略，因此验证不会递归。复核器继承父 agent 的其他工具，并在需要时使用这些工具进行验证。

## Model Experience

### 完成度复核

#### What the model sees

当前轮次事件摘要有大小限制，大型消息或工具结果块会在进入复核提示前截断。复核器收到继承的对话和当前轮次 JSON 事件记录，并且必须返回 `{status, message}` 结构化结果。复核提示要求它检查用户请求、已完成工作、工具结果和回答草稿；需要验证时可以使用继承的工具。父对话会显示 `completion_check` tool call 及其 pending/result 状态。

#### Token effect

每次 `completion_check` 调用都会增加一次复核器模型请求。`incomplete` 结果会让父 agent 增加一个步骤，该步骤通常以再次调用 `completion_check` 结束。协议恢复也会为同一次调用增加有限的复核请求。

#### KV Cache effect

复核器是独立的子 agent 请求。父 agent 的缓存上下文不会包含复核器的私有推理；只有 tool call/result 以及所需的继续上下文会保留在父对话中。

## 已知限制和后续工作

- checker 不保证正确性：它增加一次独立的模型复核，并在复核报告 `incomplete` 时要求父 agent 继续。
- 提供方在配置完成后发生失败时，父轮次采用 fail-open，因此复核不可用不会阻塞用户回答。
