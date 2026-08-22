# @deepseek-ai/dsh-completion-checker

[English](README.md) | 中文

completion checker 提供模型可见的 `completion_check` 工具。agent 在给出最终回答前必须调用它；该工具启动一次性的全新复核器，将复核反馈返回给父 agent，并在仍有工作时让父 agent 在同一轮继续。默认启用。

## 配置

```yaml
- id: completion-checker
  name: '@deepseek-ai/dsh-completion-checker'
  config:
    enabled: true
    provider: spawn
```

`enabled` 也可在 General 设置中的 `completion-checker` namespace 修改，并立即生效。`provider` 指向已注册的一次性 `ctx.subagents` 提供方。默认组合要求使用 `spawn`，因为 checker 会传入干净的 transcript，而不是继承历史。

## 复核协议

复核器以普通最终回答返回反馈，不需要调用报告工具，也不需要匹配结构化 schema。`completion_check` 工具会将该回答包装为 `{ "review": "..." }` 返回给父模型。

父 agent 完成请求工作后调用 `completion_check`。工具启动复核器，等待普通回答，释放复核器，然后把反馈可见地返回给父 agent。父 agent 必须阅读反馈并处理其中的每项修改；如果修改了工作，必须再次调用工具。复核器的措辞和格式不会被 checker 拒绝；提供方失败也会作为反馈返回，由父 agent 决定如何继续。

复核器是可见的一次性子 agent，会在运行期间出现在 subagent/session 列表中；启用持久化时，完成后的 transcript 仍可检查。工具返回前会释放它。复核器的 scoped tools 中移除了 `completion_check`，嵌套 agent 也不参与顶层完成策略，因此验证不会递归。复核器会继承父 agent 的 loop policy，并明确启用 loop detection。复核器继承父 agent 的其他工具，并在需要时使用这些工具进行验证。

## Model Experience

### 完成度复核

#### What the model sees

复核器收到所有用户可见轮次的干净时间顺序 transcript：直接用户消息、assistant 文本、带精简参数的工具调用、失败的工具结果和 todos。它不会收到继承历史、模型 reasoning、runtime context 消息、session 事件、usage 数据或原始工具参数和结果。需要验证省略的细节时，复核器可以使用继承的工具。父对话会显示 `completion_check` tool call 及其 pending/result 状态。

#### Token effect

每次 `completion_check` 调用都会增加一次复核器模型请求。需要修改的反馈会让父 agent 增加一个步骤，该步骤通常以再次调用 `completion_check` 结束。

#### KV Cache effect

复核器是独立的子 agent 请求。父 agent 的缓存上下文不会包含复核器的私有推理；只有 tool call/result 以及所需的继续上下文会保留在父对话中。

## 已知限制和后续工作

- checker 不保证正确性：它增加一次独立的模型复核，并将反馈交给父 agent 处理。
- 提供方在配置完成后发生失败时，父轮次采用 fail-open，因此复核不可用不会阻塞用户回答。
