# guard/ — 循环卫生 guard 家族

[English](README.md) | 中文

行为 guard 插件监视 agent loop 中的无效模式，并强制执行单次调用预算。guard 是核心服务和扩展点的自包含消费者，而非可替换能力。

| 包 | 职责 | ctx key |
|---|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.zh.md) | 针对重复工具调用的建议性提醒 | 监听工具和 agent 事件 |
| [`token-limit-handler/`](token-limit-handler/README.zh.md) | 输出 token 限制的恢复策略 | 监听 `agent/turn-stopping` |
| [`completion-checker/`](completion-checker/README.zh.md) | 复核已完成轮次并请求遗漏工作 | 监听 `agent/turn-stopping`，启动 fork 子 agent |
| [`timeout-policy/`](timeout-policy/README.zh.md) | 以部署策略形式设置单次工具调用终止时间 | 注册 `tools/execute` 监听器 |

提醒作为 `additionalContexts` 随 `tools/post-execute` 决策传递，并作为来源于插件的 `user/message` 事件追加记录（[工具](../../docs/subsystems/tools.zh.md)）。跨 `dsh-timeout`、能力终止与本策略层的超时拆分记录在[超时库 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.zh.md)。
