# Agent Note: Recovery prompts use the agent conversation role

[English](2026-08-21-recovery-prompts-use-agent-role.md) | 中文

恢复生产者角色已由 [Recovery prompts follow provider role sequencing](2026-08-21-recovery-prompts-follow-provider-role-sequencing.zh.md) 取代。

Status: implemented

## Problem

循环检测和输出 token 恢复提示通过 agent inbox 以 user 角色消息排队，因此模型可能将自动继续请求理解为新的人工请求。

## Decision

恢复生产者会用 `modelRole: 'assistant'` 标记内部消息，会话的规范 surface projection 再将这些持久化的 `user/message` 事件以 `assistant` 消息呈现给模型。直接人工提示和其他注入上下文仍保持 user 角色。持久化事件类型和来源归属保持不变，因此 inbox 所有权、transcript 渲染、回放和持久化仍描述提供输入的生产者。

该 projection 使用原消息的 identity、content 和 source 创建冻结的 assistant 角色副本。这样角色转换可以从会话日志确定性重建，并对每个 adapter 请求一致生效，同时不会让 session 包依赖恢复插件名称。

## Alternatives considered

**将持久化事件改为 `assistant/message`。** 不采用，因为恢复提示是通过 `steer()` 排队的 agent 输入，而不是模型输出；改变事件会为了模型请求的呈现细节改变 transcript 所有权、事件校验和 inbox API。

**将恢复提示作为 `system` 消息发送。** 不采用，因为 provider-neutral history 模型和 pi-ai adapter 不会将历史中的 system 消息保留为通用 wire 角色；这里需要表达的是 agent 拥有继续动作，`assistant` 直接表达了这一点。

**保留 `user` 角色，只在提示文字中说明它是自动生成的。** 不采用，因为文字无法改变导致模型将继续动作归因于人工的角色语义。

## Consequences

模型会以 assistant 角色接收 loop 和 token-limit 恢复提示，而持久化会话和客户端 transcript 仍保留插件来源的 user-message 记录。共享 source 标记和 projection 负责该规则，因此两个恢复插件及未来的内部恢复生产者使用同一角色，不需要 provider-specific 分支或 session 包中的插件名称检查。

针对 session、loop detection 和 token-limit-handler 的 focused 测试验证角色转换，保留人工输入及普通插件输入的 user 角色，并覆盖 reasoning 与 tool-call loop 恢复。
