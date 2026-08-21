# Agent Note：在轮次结束前进行完成度复核

状态：已实现

[English](2026-08-21-completion-review-before-turn-close.md) | 中文

## 问题

agent 可能在给出看似合理的回答后停止，但仍遗漏用户要求的验证、编辑或后续工作。轮次终止检查点允许策略插件引导下一步，但没有独立复核已完成的工作。

## 决策

`@deepseek-ai/dsh-completion-checker` 注册模型可见的 `completion_check` 工具。该工具在父模型步骤内启动带结构化输出的一次性 `fork` 子 agent。fork 继承已关闭的对话前缀，并在复核提示中收到当前轮次的事件记录。终止监听器不再启动子 agent；它只要求未检查的完成轮次先调用工具，并在复核结果为 incomplete 后要求再次检查。

复核协议是 `{ status: 'complete' | 'incomplete' | 'unavailable'; message: string }`。父 agent 在最终回答前调用 `completion_check`；工具等待结构化结果，释放复核器，并返回可见 verdict。`complete` 表示请求完成，`incomplete` 将所需修改返回父 agent，父 agent 完成修改后必须再次调用工具。如果复核器没有生成结构化输出，checker 会使用更严格的协议提示进行有限次恢复，并在下一次尝试前释放失败的运行。达到配置的尝试上限后返回 `unavailable`，报告复核失败并对当前轮次 fail-open；同一轮次的后续调用复用该结果，不再启动新的复核循环。复核器是可见的一次性子 agent，运行期间出现在 subagent 列表中；启用持久化时其 transcript 仍可检查，工具返回前会释放它。嵌套 agent 无法调用 checker，因此验证不会递归。

`completion-checker` 设置 namespace 暴露 `enabled`，默认值为 `true` 且实时生效。provider 名称和有上限的 `maxAttempts` 恢复预算属于组合配置，默认分别为 `fork` 和 `2`。基础 bundle 会挂载 `fork` provider。

## 考虑过的替代方案

**从 `agent/turn-stopping` 启动复核。** 放弃，因为终止检查点是一个等待中的隐藏副作用：provider 或子 agent 生命周期延迟可能让父 agent 显示检查提示，却没有可见的模型请求。模型可见的 tool call 将复核放在可观察的模型步骤中，并直接把结果交给父 agent。

**使用普通的全新 `spawn` provider。** 放弃，因为全新的子 agent 无法检查继承的对话，除非把完整历史复制到提示中；fork 保留父上下文，当前轮次补充只覆盖尚未关闭的后缀。

**解析复核器的自由文本回答。** 放弃，因为完成状态和继续消息是模型可见的控制数据；结构化输出协议可以让格式错误的决定 fail-open，而不会依据含义不明确的文本进行引导。

## 后果

用户可以看到 `completion_check` tool call 及其 pending/result 生命周期，复核仍作为子 agent 活动存在，不会成为父对话中的第二条 assistant 回答。不完整结果会让父 agent 继续，并在修改后重复 tool call。复核失败不会阻塞回答，因此 provider 暂时不可用不会成为新的硬依赖。

复核器继承父 agent 的工具，但其 scoped tool view 会移除 `completion_check`。嵌套 agent 不接收完成策略，终止 guard 也忽略它们，因此验证不会递归。终止 guard 只为每个活动父 agent 保留最新复核状态，不持久化该协调状态。

当前轮次补充是有界的事件摘要，而不是无损日志，因此大型工具结果不会耗尽复核上下文。只有 agent-loop 自动压缩提示从完成度复核中排除；模型回答第三次 loop retry 提示后仍会接受复核。
