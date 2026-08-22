/** Expose a visible completion review and continue the parent when it finds unfinished work.
 *
 * The reviewer is a fresh one-shot subagent launched by a model-visible tool.
 * It receives a compact task brief built from the parent's session events.
 *
 * @module @deepseek-ai/dsh-completion-checker
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ObjectJsonSchema, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** User-selectable completion-review settings. */
export interface CompletionCheckerSettings {
  /** Whether a completed turn receives a completion review. */
  enabled: boolean
}

/** Plugin configuration. */
export interface Config {
  /** Whether reviews are enabled by default. */
  enabled?: boolean
  /** Registry name of the one-shot subagent provider used for reviews. */
  provider?: string
}

/** Settings namespace exposed on the General settings surface. */
export const COMPLETION_CHECKER_SETTINGS_NAMESPACE = settingsNamespace('completion-checker')

/** The shipped default for the General setting. */
export const DEFAULT_COMPLETION_CHECKER_ENABLED = true

/** The default provider, which starts with only the generated task brief. */
export const DEFAULT_COMPLETION_CHECKER_PROVIDER = 'spawn'

/** Schema for the plugin's composition configuration. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(DEFAULT_COMPLETION_CHECKER_ENABLED),
  provider: z.string().default(DEFAULT_COMPLETION_CHECKER_PROVIDER),
})

/** Schema for the user-owned settings section. */
export const COMPLETION_CHECKER_SETTINGS_SCHEMA: z<CompletionCheckerSettings> = z.object({
  enabled: z.boolean().default(DEFAULT_COMPLETION_CHECKER_ENABLED),
})

/** Source stamped on review messages sent back to the parent agent. */
const PLUGIN_SOURCE: Extract<MessageSource, { kind: 'plugin' }> = { kind: 'plugin', plugin: 'completion-checker' }

/** Load with tools and system-prompt services; the review provider may appear later. */
export const inject = ['subagents', 'tools', 'systemPrompt']

/** Canonical result returned by the visible completion-check tool. */
const COMPLETION_REVIEW_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    review: { type: 'string' },
  },
  required: ['review'],
  additionalProperties: false,
}

type CompletionReview = { review: string }

const REVIEW_ACTION_MAX_CHARS = 600
const OMITTED_TOOL_ARGUMENT_KEYS = new Set(['content', 'patch', 'body'])

type TurnStoppingPayload = {
  agent: Agent
  turn: number
  reason: TurnEndReason
  stepReason: TurnEndReason
  signal: AbortSignal
}

function clipReviewText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}… [truncated]`
}

function textContent(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function toolArgumentsSummary(argumentsText: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return clipReviewText(argumentsText, REVIEW_ACTION_MAX_CHARS)
    }
    const summary = Object.fromEntries(Object.entries(parsed).map(([key, value]) => {
      if (OMITTED_TOOL_ARGUMENT_KEYS.has(key) && typeof value === 'string') {
        return [key, `[${value.length} characters omitted]`]
      }
      if (typeof value === 'string') return [key, clipReviewText(value, 240)]
      return [key, value]
    }))
    return clipReviewText(JSON.stringify(summary), REVIEW_ACTION_MAX_CHARS)
  } catch {
    return clipReviewText(argumentsText, REVIEW_ACTION_MAX_CHARS)
  }
}

function currentTurnEvents(agent: Agent, turn: number): SessionEvent[] {
  const start = agent.session.events.findLastIndex(event => event.type === 'turn/start' && event.data.turn === turn)
  return agent.session.events.slice(start < 0 ? 0 : start)
}

/** Project every user-visible turn into a transcript without model or runtime internals. */
function cleanConversation(agent: Agent): string {
  const entries: string[] = []
  for (const event of agent.session.events) {
    switch (event.type) {
      case 'user/message': {
        if (event.data.source.kind !== 'user') break
        const text = textContent(event.data.content)
        if (text !== '') entries.push(`User:\n${text}`)
        break
      }
      case 'assistant/message': {
        const text = textContent(event.data.message.content)
        if (text !== '') entries.push(`Agent:\n${text}`)
        break
      }
      case 'tool/call':
        if (event.data.name !== 'completion_check') {
          entries.push(`Agent used ${event.data.name}: ${toolArgumentsSummary(event.data.arguments)}`)
        }
        break
      case 'tool/result':
        if (event.data.error !== undefined) {
          entries.push(`Tool result: failed — ${clipReviewText(JSON.stringify(event.data.error), REVIEW_ACTION_MAX_CHARS)}`)
        }
        break
      case 'todo/write':
        entries.push(`Agent todos:\n${JSON.stringify(event.data.todos)}`)
        break
      default:
        break
    }
  }
  return entries.length === 0 ? '[No user-visible conversation was recorded.]' : entries.join('\n\n')
}

function isLoopRecoveryTurn(events: readonly SessionEvent[]): boolean {
  return events.some(event => event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'agent-loop'
    && event.data.source.form === 'notice'
    && event.data.source.summary === 'compacting after repeated loop')
}

/** Identify nested agents, which do not run the top-level completion policy. */
function isNestedAgent(agent: Agent): boolean {
  return agent.session.header.parentSession !== undefined
}

/** Prompt a fresh reviewer with the complete clean conversation transcript. */
function reviewPrompt(agent: Agent): string {
  return [
    'Decide whether the agent has fulfilled the user requests in the complete conversation below.',
    'The transcript includes every user-visible turn and summarized tool activity, but excludes model reasoning, runtime context, and raw tool payloads/results.',
    'Use available tools only to verify the listed work. Do not make changes just to inspect it.',
    'Return your review as a normal final response. Do not call completion_check or any reporting tool, and do not use structured output.',
    'State clearly what the parent agent should verify, change, or continue; if there are no issues, say so.',
    '',
    'Clean conversation transcript:',
    cleanConversation(agent),
  ].join('\n')
}

/** Collect the reviewer's ordinary textual final response without enforcing a schema. */
function reviewerText(result: SubagentResult): string {
  const text = result.output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  if (text !== '') return text
  if (result.diagnostic !== undefined) return result.diagnostic
  return `The reviewer returned no text (stop reason: ${result.stopReason}).`
}

/** Ask the parent to use the visible completion-check tool before replying. */
function checkRequestMessage() {
  return createUserMessage({
    content: [{ type: 'text', text: 'Before replying to the user, call the `completion_check` tool. Read its feedback, address the requested changes, and call it again after making changes.' }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'completion check required' },
  })
}

/** Render the completion-check tool result for the parent model and user UI. */
function renderReview(review: CompletionReview): ContentBlock[] {
  return [{ type: 'text', text: `Completion reviewer feedback:\n\n${review.review}\n\nRead this feedback, address any requested changes, and call completion_check again if you changed the work.` }]
}

/** Install the visible completion review and its terminal-call guard. */
export function apply(ctx: Context, config: Config): void {
  const entry: CompletionCheckerSettings = {
    enabled: config.enabled ?? DEFAULT_COMPLETION_CHECKER_ENABLED,
  }
  let source: () => CompletionCheckerSettings = () => entry
  installSettingsSection(ctx, COMPLETION_CHECKER_SETTINGS_NAMESPACE, COMPLETION_CHECKER_SETTINGS_SCHEMA, entry, {
    setSource: (current) => { source = current },
    onChange: () => {},
  })

  const reviewStates = new WeakMap<Agent, { turn: number; review: CompletionReview }>()
  const providerName = config.provider ?? DEFAULT_COMPLETION_CHECKER_PROVIDER

  // Provider plugins can register after this plugin. Mount the visible tool,
  // its prompt policy, and the terminal guard when the configured provider
  // becomes available.
  let disposeTool: (() => void) | undefined
  let disposePrompt: (() => void) | undefined
  let disposeTurnStopping: (() => void) | undefined
  const onTurnStopping = ({ agent, turn, reason }: TurnStoppingPayload) => {
    if (reason.kind !== 'completed'
      || isNestedAgent(agent)
      || !source().enabled) return
    if (isLoopRecoveryTurn(currentTurnEvents(agent, turn))) return
    const state = reviewStates.get(agent)
    if (state?.turn === turn) {
      return
    }
    agent.steer(checkRequestMessage())
  }

  const mount = () => {
    if (disposeTool !== undefined || ctx.subagents.getProvider(providerName) === undefined) return
    const tool: ToolDefinition = {
      name: 'completion_check',
      description: 'Validate the current task with an independent reviewer before giving the final answer. Call this after completing the work and call it again after addressing any requested changes.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: COMPLETION_REVIEW_OUTPUT_SCHEMA,
        render: (_args, value) => renderReview(value as unknown as CompletionReview),
      },
      async execute(_args, exec) {
        const parent = exec.agent
        if (parent === undefined) throw new Error('completion_check requires a calling agent')
        if (!source().enabled) throw new Error('completion checker is disabled')
        if (isNestedAgent(parent)) throw new Error('completion_check is unavailable inside a reviewer subagent')
        const turn = parent.session.events.findLast(event => event.type === 'turn/start')
        if (turn === undefined) throw new Error('completion_check requires an active agent turn')
        let run: SubagentRun | undefined
        try {
          run = await ctx.subagents.start(providerName, {
            label: 'completion-checker',
            prompt: [{ type: 'text', text: reviewPrompt(parent) }],
            parent,
            signal: exec.signal,
            agentOptions: {
              loopDetection: {
                ...parent.options.loopDetection,
                enabled: true,
              },
            },
            toolFilter: { deny: ['completion_check'] },
          })
          const review = { review: reviewerText(await run.result) }
          reviewStates.set(parent, { turn: turn.data.turn, review })
          return review
        } catch (error: unknown) {
          if (exec.signal.aborted) throw error
          const review = { review: `The reviewer failed before producing feedback: ${String(error)}\nProceed using your own judgment and do not claim that the review passed.` }
          reviewStates.set(parent, { turn: turn.data.turn, review })
          return review
        } finally {
          if (run !== undefined) await run.dispose()
        }
      },
    }
    disposeTool = ctx.tools.register(tool)
    disposePrompt = ctx.systemPrompt.section({
      name: 'tool:completion-check',
      order: 197,
      text: ({ agent }) => agent === undefined || isNestedAgent(agent)
        ? ''
        : 'Before giving a final answer, you MUST call the `completion_check` tool. Read the reviewer feedback, address every requested change, and call `completion_check` again after making changes.',
    })
    disposeTurnStopping = ctx.on('agent/turn-stopping', onTurnStopping)
  }
  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === providerName) mount()
  })
  ctx.on('subagent/provider-removed', (name) => {
    if (name !== providerName) return
    disposeTool?.()
    disposeTool = undefined
    disposePrompt?.()
    disposePrompt = undefined
    disposeTurnStopping?.()
    disposeTurnStopping = undefined
  })
  mount()
}

export const name = 'completion-checker'
