# Agent Note: 在轮次关闭前复核完成度

Status: implemented

[English](2026-08-21-completion-review-before-turn-close.md) | 中文

## Problem

agent 可能在生成看似合理的回答后停止，但用户要求的验证、编辑或后续工作仍未完成。终止轮次检查点已经允许策略插件引导新的步骤，但还没有策略独立复核已完成的工作。

## Decision

`@deepseek-ai/dsh-completion-checker` 监听普通完成轮次的 `agent/turn-stopping`，并使用结构化输出启动一次性的 `fork` 子 agent。fork 继承已经关闭的对话前缀，并在复核提示词中收到当前轮次的事件记录，因为检查点执行时当前轮次还没有追加 `turn/end`。

复核协议是 `{ status: 'complete' | 'incomplete'; message: string }`。插件会先记录可见的 `Double-checking results before stopping…` 插件通知，让父 UI 显示复核期间。不完整结果必须包含可执行的消息；插件会把消息记录为插件来源的 `user/message`，并在轮次关闭前调用 `agent.steer()`。完整、无效、失败、中止以及非完成的复核都保持原终止决定不变。复核运行在结算后释放，活动 agent 集合会阻止递归复核。

`completion-checker` settings namespace 提供 `enabled`，默认值为 `true`，并且实时生效。提供方名称仍属于组合配置，默认使用由 base bundle 挂载的 `fork`。

## Alternatives considered

**等待 `turn/end` 后再启动复核。** 否决：越过终止边界后的事件无法同步参与当前轮次的关闭决定；不完整复核需要单独的唤醒策略，并可能与用户输入竞争。

**使用普通的全新 `spawn` 提供方。** 否决：全新子 agent 无法查看继承的对话，除非把完整历史复制到提示词；fork 保留父对话，而当前轮次补充只覆盖尚未关闭的后缀。

**解析复核器的自由文本回答。** 否决：完成状态和继续消息是模型可见的控制数据；结构化输出协议让格式错误 fail-open，而不是根据含义不明确的文本引导继续。

## Consequences

当复核器发现遗漏工作时，用户可能看到一个额外的 agent 步骤，而复核本身作为子活动存在，不会成为父 transcript 中的第二条 assistant 回答。复核失败不会阻塞回答，因此该功能以机会式方式提高完成度，在组合成功后不会变成新的提供方可用性要求。

复核器继承父 agent 的工具，并可以使用这些工具验证声明。递归检查通过在内存中跟踪父 agent 和复核器 agent 身份来抑制；这项状态只协调一次实时终止检查点，因此不会持久化。

当前轮次补充内容使用有上限的事件摘要，而不是无损日志，因此大型工具结果不会耗尽复核器的上下文。带有 agent-loop 恢复通知的轮次会排除完成度复核；自动循环压缩会在维护开始前记录自己的可见通知。
