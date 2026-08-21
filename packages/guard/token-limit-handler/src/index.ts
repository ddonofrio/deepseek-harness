/** Recover an agent when a model response reaches its output-token limit.
 *
 * @module @deepseek-ai/dsh-token-limit-handler
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

/** User-selectable response to an output-token limit. */
export type TokenLimitAction = 'stop' | 'continue' | 'custom-prompt'

/** Settings owned by the token-limit handler. */
export interface TokenLimitHandlerSettings {
  /** Whether to stop, send `continue`, or send {@link customPrompt}. */
  action: TokenLimitAction
  /** Maximum consecutive `continue` prompts for the current recovery chain. */
  continueCount: number
  /** Prompt sent when `action` is `custom-prompt`. */
  customPrompt: string
}

/** Plugin configuration; omitted values use the default recovery policy. */
export interface Config {
  /** Response to an output-token limit; defaults to `continue`. */
  action?: TokenLimitAction
  /** Consecutive `continue` prompts; defaults to `5`. */
  continueCount?: number
  /** Prompt used by the `custom-prompt` action. */
  customPrompt?: string
}

/** Settings namespace exposed to the General settings surface. */
export const TOKEN_LIMIT_HANDLER_SETTINGS_NAMESPACE = settingsNamespace('token-limit-handler')

/** The shipped default action. */
export const DEFAULT_TOKEN_LIMIT_ACTION: TokenLimitAction = 'continue'
/** The shipped default consecutive continuation count. */
export const DEFAULT_TOKEN_LIMIT_CONTINUE_COUNT = 5

/** Schema for the plugin's composition configuration. */
export const Config: z<Config> = z.object({
  action: z.union(['stop', 'continue', 'custom-prompt'] as const).default(DEFAULT_TOKEN_LIMIT_ACTION),
  continueCount: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_TOKEN_LIMIT_CONTINUE_COUNT),
  customPrompt: z.string().default(''),
})

/** Schema for the user-owned settings section. */
export const TOKEN_LIMIT_HANDLER_SETTINGS_SCHEMA: z<TokenLimitHandlerSettings> = z.object({
  action: z.union(['stop', 'continue', 'custom-prompt'] as const).default(DEFAULT_TOKEN_LIMIT_ACTION),
  continueCount: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_TOKEN_LIMIT_CONTINUE_COUNT),
  customPrompt: z.string().default(''),
})

/** Source stamped on prompts this policy sends to the model. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'token-limit-handler', modelRole: 'assistant' }

/** Validate values the schema cannot accept conditionally. */
function validateSettings(settings: TokenLimitHandlerSettings): void {
  if (!Number.isSafeInteger(settings.continueCount) || settings.continueCount < 1) {
    throw new Error('token-limit-handler: continueCount must be a positive safe integer')
  }
  if (settings.action === 'custom-prompt' && settings.customPrompt.trim() === '') {
    throw new Error('token-limit-handler: customPrompt must not be empty for the custom-prompt action')
  }
}

/** Convert optional plugin configuration into the complete settings entry. */
function resolveEntry(config: Config): TokenLimitHandlerSettings {
  const entry: TokenLimitHandlerSettings = {
    action: config.action ?? DEFAULT_TOKEN_LIMIT_ACTION,
    continueCount: config.continueCount ?? DEFAULT_TOKEN_LIMIT_CONTINUE_COUNT,
    customPrompt: config.customPrompt ?? '',
  }
  validateSettings(entry)
  return entry
}

/** Build one logged user message for a recovery action. */
function recoveryMessage(action: TokenLimitAction, count: number, prompt: string) {
  return createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: {
      ...PLUGIN_SOURCE,
      form: 'notice',
      summary: action === 'continue' ? `continue ${count}` : 'custom token-limit prompt',
    },
  })
}

/**
 * Install the output-token recovery policy.
 * @param ctx - plugin context whose listeners and settings registration share one lifetime.
 * @param config - composition defaults for the policy.
 */
export function apply(ctx: Context, config: Config): void {
  const entry = resolveEntry(config)
  let source: () => TokenLimitHandlerSettings = () => entry
  installSettingsSection(ctx, TOKEN_LIMIT_HANDLER_SETTINGS_NAMESPACE, TOKEN_LIMIT_HANDLER_SETTINGS_SCHEMA, entry, {
    setSource: (current) => { source = current },
    validate: validateSettings,
    onChange: () => {},
  })

  const counts = new WeakMap<Agent, number>()
  ctx.on('agent/turn-stopping', ({ agent, stepReason, signal }) => {
    if (stepReason.kind !== 'max-tokens') {
      counts.delete(agent)
      return
    }

    const settings = source()
    if (settings.action === 'stop') {
      counts.delete(agent)
      return
    }

    const count = (counts.get(agent) ?? 0) + 1
    counts.set(agent, count)
    if (settings.action === 'continue' && count > settings.continueCount) {
      counts.delete(agent)
      return
    }

    signal.throwIfAborted()
    const prompt = settings.action === 'continue' ? 'continue' : settings.customPrompt
    agent.steer(recoveryMessage(settings.action, count, prompt))
  })
}

export const name = 'token-limit-handler'
