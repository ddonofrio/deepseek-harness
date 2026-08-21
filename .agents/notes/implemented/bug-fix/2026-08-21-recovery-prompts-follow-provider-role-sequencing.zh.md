# Agent Note: Recovery prompts follow provider role sequencing

Status: implemented

[English](2026-08-21-recovery-prompts-follow-provider-role-sequencing.md) | 中文

本说明取代 [Recovery prompts use the agent conversation role](2026-08-21-recovery-prompts-use-agent-role.zh.md) 中描述的恢复生产者角色。

## Problem

循环检测和输出 token 恢复提示会被投影为 assistant 消息，紧跟在触发恢复的部分 assistant 响应之后。拒绝连续 assistant 消息的提供方会在生成开始前拒绝下一次请求。

## Decision

循环检测器和 token-limit handler 将恢复提示保持为普通 user 角色的 `user/message` 事件。它们的插件来源仍标识提供方，`notice` 形式仍为持久化消费者描述该消息。这样提示仍然对模型可见并且可以重建，同时不会让请求末尾出现两条 assistant 消息。

可选的 `modelRole: 'assistant'` 来源标记仍可供明确需要 assistant 展示的插件消息使用。恢复 handler 不使用该标记，因为它们的提示跟在模型输出之后，必须满足提供方的角色顺序要求。

## Alternatives considered

**保留 assistant 角色的恢复提示。** 不采用，因为每条恢复提示前面已经有部分或完整的 assistant 响应；例如 `llama-server` 的提供方会拒绝这种请求顺序。

**将恢复提示合并到前一条 assistant 消息。** 不采用，因为这会改变持久化消息投影，并把 agent 指令呈现为模型生成的输出。

**在每个提供方 adapter 内规范化相邻的 assistant 消息。** 不采用，因为恢复顺序是共享的 agent 行为；提供方特定的规范化会让请求重建与提供方行为产生差异。

## Consequences

每个循环检测和输出 token 恢复请求都以 user 角色干预结束，而不是连续的 assistant 消息。持久化输入所有权、来源归属、持久化和回放保持不变。模型仍会在下一步收到配置的恢复文本，同时采用严格角色顺序的提供方也可以接受该请求。

聚焦的 agent-loop 和 token-limit-handler 测试断言 user 角色恢复，并在循环恢复 transcript 中拒绝相邻的 assistant 消息。
