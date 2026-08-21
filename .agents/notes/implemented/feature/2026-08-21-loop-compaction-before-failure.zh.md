# Agent Note: 在循环终止前压缩上下文

Status: implemented

[English](2026-08-21-loop-compaction-before-failure.md) | 中文

## 问题

模型输出在三次干预提示词后仍可能保持重复，因为导致循环的上下文仍保留在会话中。第四次连续检测目前没有恢复步骤，会以 `LLM_LOOP` 结束 agent。

## 决策

`LoopDetectionOptions.compactBeforeFailing` 与 General 设置 `loopDetectionCompactBeforeFailing` 的默认值都是 `false`。启用后，第四次连续检测会保存当前轮次领取的消息，以循环错误结束该轮，并将恢复延迟到 driver 进入 idle。随后 agent 调用压缩提供方的 `compactNow` 路径；这与 `/compact` 使用相同的 idle 维护操作，唤醒输入会在操作完成前保留在队列中。结果非 `null` 时，保存的消息会被放到 `next-turn` 的队首，在新的轮次中重新派发；原始用户输入被领取后，连续循环计数会重置。缺少压缩服务、结果为 `null` 或后端报错时不会伪造恢复，循环错误或后端错误保持终止。

压缩 seam 仍将 `loop-detection` 与压力和提供方确认的上下文溢出分开命名，用于直接的自动策略。这里的恢复路径有意改用 `compactNow`，因为它必须共享显式命令的 idle 会话生命周期。

## 备选方案

**复用 `context-overflow` 触发器。** 不采用，因为循环检测不是提供方确认的上下文溢出；独立触发器能让后端策略和遥测保持准确。

**压缩后再排队一个新的干预提示词。** 不采用，因为恢复必须让产生循环的请求在压缩后的 surface 上重放；添加另一个提示词会改变请求，而不是移除导致重复输出的上下文。

**在活动轮次内执行压缩。** 不采用，因为 `compactIfNeeded` 受当前轮次所有权约束，无法提供 `/compact` 的 idle 维护生命周期和新的轮次边界。

**启用选项后强制要求压缩服务存在。** 不采用，因为压缩服务是可选的，有些部署没有安全范围或压缩后端；这些部署保留原有的终止错误。

## 验证

agent-loop 测试覆盖 idle `compactNow` 恢复、新轮次中的原始输入重放、计数器重置、没有有效范围以及没有安装提供方的情况。Settings 测试覆盖 General 字段及其到新 agent 的投影。压缩 Service Definition 测试和 basic 后端的分支独立覆盖 `loop-detection` 触发器。

## 后果

启用该选项的部署可以在每次后端调用都产生替换时重复执行 idle 压缩和新轮次，因此该选项有意不增加额外的循环上限。每次成功压缩都通过现有压缩事件持久化，重试输入则作为检查点之后的新轮次记录。
