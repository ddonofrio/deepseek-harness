# Agent Note：在轮次结束前进行完成度复核

状态：已实现

[English](2026-08-21-completion-review-before-turn-close.md) | 中文

## 问题

agent 可能在给出看似合理的回答后停止，但仍遗漏用户要求的验证、编辑或后续工作。轮次终止检查点允许策略插件引导下一步，但没有独立复核已完成的工作。

## 决策

`@deepseek-ai/dsh-completion-checker` 注册模型可见的 `completion_check` 工具。该工具在父模型步骤内启动一次性、可见的 `spawn` 子 agent，并将子 agent 的普通文本回答作为反馈返回。子 agent 收到父 agent 所有用户可见轮次的干净时间顺序 transcript：直接用户消息、assistant 文本、带精简参数的工具调用、失败的工具结果和 todos。它排除模型 reasoning、runtime context、session 事件、usage 数据和原始工具参数及结果。其 loop detector 使用父 agent 的策略并明确启用。终止监听器不再启动子 agent；它只要求未检查的完成轮次先调用工具。

复核器不使用 output schema。父 agent 在最终回答前调用 `completion_check`；工具等待复核器的普通回答，释放复核器，并将 `{ review: string }` 作为可见反馈返回。父 agent 必须处理反馈，并在修改工作后再次调用工具。复核器是可见的一次性子 agent，运行期间出现在 subagent 列表中；启用持久化时其 transcript 仍可检查，工具返回前会释放它。嵌套 agent 无法调用 checker，因此验证不会递归。

`completion-checker` 设置 namespace 暴露 `enabled`，默认值为 `true` 且实时生效。provider 名称属于组合配置，默认值为 `spawn`，基础 bundle 会挂载该 provider。

## 考虑过的替代方案

**从 `agent/turn-stopping` 启动复核。** 放弃，因为终止检查点是一个等待中的隐藏副作用：provider 或子 agent 生命周期延迟可能让父 agent 显示检查提示，却没有可见的模型请求。模型可见的 tool call 将复核放在可观察的模型步骤中，并直接把结果交给父 agent。

**使用 `fork` provider。** 放弃，因为它继承的父历史包含对完成度复核没有帮助的模型和 runtime 数据。全新子 agent 改为接收完整的干净 transcript。

**要求复核器返回结构化输出。** 放弃，因为复核器的回答是给父 agent 的反馈，而不是由 checker 强制执行的机器判定。父 agent 阅读回答后决定需要处理哪些修改。

## 后果

用户可以看到 `completion_check` tool call 及其 pending/result 生命周期，复核仍作为子 agent 活动存在，不会成为父对话中的第二条 assistant 回答。反馈会交给父 agent 处理；如果父 agent 修改了工作，就应重复 tool call。复核失败不会阻塞回答，因此 provider 暂时不可用不会成为新的硬依赖。

复核器继承父 agent 的工具，但其 scoped tool view 会移除 `completion_check`。嵌套 agent 不接收完成策略，终止 guard 也忽略它们，因此验证不会递归。复核器使用父 agent 的 loop policy，并明确启用 loop detection。终止 guard 只为每个活动父 agent 保留最新反馈，不持久化该协调状态。

干净 transcript 携带所有用户可见轮次，因此复核器可以评估跨越早期轮次的工作，而不会收到模型或 runtime 内部数据。工具参数和成功结果正文保持排除；需要细节时复核器使用继承的工具检查。只有 agent-loop 自动压缩提示从完成度复核中排除；模型回答第三次 loop retry 提示后仍会接受复核。
