/** Expose a visible completion review and continue the parent when it finds unfinished work.
 *
 * The reviewer is a forked one-shot subagent launched by a model-visible tool.
 * Forked history contains the completed conversation prefix; the tool prompt
 * also includes the current turn because that turn has not reached `turn/end`.
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
  /** Maximum number of reviewer attempts when structured output is missing. */
  maxAttempts?: number
}

/** Settings namespace exposed on the General settings surface. */
export const COMPLETION_CHECKER_SETTINGS_NAMESPACE = settingsNamespace('completion-checker')

/** The shipped default for the General setting. */
export const DEFAULT_COMPLETION_CHECKER_ENABLED = true

/** The default provider, which inherits the parent's completed conversation. */
export const DEFAULT_COMPLETION_CHECKER_PROVIDER = 'fork'

/** The default bounded retry budget for a reviewer protocol recovery. */
export const DEFAULT_COMPLETION_CHECKER_MAX_ATTEMPTS = 2

const MAX_COMPLETION_CHECKER_ATTEMPTS = 3

/** Schema for the plugin's composition configuration. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(DEFAULT_COMPLETION_CHECKER_ENABLED),
  provider: z.string().default(DEFAULT_COMPLETION_CHECKER_PROVIDER),
  maxAttempts: z.number().step(1).min(1).max(MAX_COMPLETION_CHECKER_ATTEMPTS).default(DEFAULT_COMPLETION_CHECKER_MAX_ATTEMPTS),
})

/** Schema for the user-owned settings section. */
export const COMPLETION_CHECKER_SETTINGS_SCHEMA: z<CompletionCheckerSettings> = z.object({
  enabled: z.boolean().default(DEFAULT_COMPLETION_CHECKER_ENABLED),
})

/** Source stamped on review messages sent back to the parent agent. */
const PLUGIN_SOURCE: Extract<MessageSource, { kind: 'plugin' }> = { kind: 'plugin', plugin: 'completion-checker' }

/** Load with tools and system-prompt services; the review provider may appear later. */
export const inject = ['subagents', 'tools', 'systemPrompt']

/** Structured result required from the completion reviewer. */
const COMPLETION_REVIEW_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['complete', 'incomplete', 'unavailable'] },
    message: { type: 'string' },
  },
  required: ['status', 'message'],
  additionalProperties: false,
}

type CompletionReview = { status: 'complete' | 'incomplete' | 'unavailable'; message: string }

const REVIEW_PROMPT_MAX_CHARS = 12000
const REVIEW_BLOCK_MAX_CHARS = 2000

type TurnStoppingPayload = {
  agent: Agent
  turn: number
  reason: TurnEndReason
  stepReason: TurnEndReason
  signal: AbortSignal
}

function clipReviewText(text: string, maxChars = REVIEW_BLOCK_MAX_CHARS): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}… [truncated]`
}

function compactReviewContent(blocks: readonly ContentBlock[]): unknown[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        return { type: block.type, text: clipReviewText(block.text) }
      case 'tool-call':
        return { type: block.type, name: block.name, arguments: clipReviewText(block.arguments) }
      case 'tool-result':
        return {
          type: block.type,
          toolCallId: block.toolCallId,
          isError: block.isError,
          content: compactReviewContent(block.content),
        }
      case 'image':
        return { type: block.type, omitted: true }
      default:
        return { type: 'unknown' }
    }
  })
}

function compactReviewEvents(events: readonly SessionEvent[]): unknown[] {
  return events.flatMap((event): unknown[] => {
    switch (event.type) {
      case 'turn/start':
      case 'step/start':
      case 'step/end':
        return [{ seq: event.seq, type: event.type, data: event.data }]
      case 'user/message':
        return [{ seq: event.seq, type: event.type, content: compactReviewContent(event.data.content), source: event.data.source.kind === 'user' ? 'user' : event.data.source }]
      case 'assistant/message':
        return [{
          seq: event.seq,
          type: event.type,
          turn: event.data.turn,
          step: event.data.step,
          content: compactReviewContent(event.data.message.content),
          usage: event.data.usage,
          interrupted: event.data.interrupted,
        }]
      case 'tool/call':
        return [{
          seq: event.seq,
          type: event.type,
          turn: event.data.turn,
          step: event.data.step,
          name: event.data.name,
          arguments: clipReviewText(event.data.arguments),
        }]
      case 'tool/result':
        return [{
          seq: event.seq,
          type: event.type,
          turn: event.data.turn,
          step: event.data.step,
          message: { content: compactReviewContent(event.data.message.content) },
          error: event.data.error,
        }]
      case 'todo/write':
        return [{ seq: event.seq, type: event.type, todos: event.data.todos }]
      default:
        return []
    }
  })
}

function currentTurnEvents(agent: Agent, turn: number): SessionEvent[] {
  const start = agent.session.events.findLastIndex(event => event.type === 'turn/start' && event.data.turn === turn)
  return agent.session.events.slice(start < 0 ? 0 : start)
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

/** Prompt the reviewer to validate the user's request and the current turn. */
function reviewPrompt(agent: Agent, turn: number): string {
  const serialized = JSON.stringify(compactReviewEvents(currentTurnEvents(agent, turn)))
  const bounded = serialized.length <= REVIEW_PROMPT_MAX_CHARS
    ? serialized
    : `${serialized.slice(0, REVIEW_PROMPT_MAX_CHARS)}\n[remaining current-turn events omitted; use tools to verify details]`
  return [
    'Review the inherited conversation and the current turn before deciding whether the agent is finished.',
    'Check the original user request, the work performed, tool results, and the final answer.',
    'Use the available tools when a fact must be verified. Do not make changes just to inspect them.',
    'Return only the structured review result required by the output schema.',
    'Use status "complete" with an empty message when the request is fully satisfied.',
    'Use status "incomplete" with a concise, actionable message when the agent must continue.',
    '',
    'Current turn event log (JSON):',
    bounded,
  ].join('\n')
}

/** Add a protocol-recovery instruction after an attempt omitted structured output. */
function reviewAttemptPrompt(agent: Agent, turn: number, attempt: number): string {
  const prompt = reviewPrompt(agent, turn)
  if (attempt === 0) return `${prompt}\nCall the structured_output tool exactly once with the review object; do not answer in prose.`
  return `${prompt}\nThis is protocol recovery attempt ${attempt + 1}. The previous attempt did not produce a valid structured result. Call the structured_output tool exactly once, with exactly {"status":"complete"|"incomplete","message":"..."}; do not finish with prose or another tool call.`
}

/** Build the fail-open verdict after bounded reviewer recovery failed. */
function unavailableReview(message: string): CompletionReview {
  return { status: 'unavailable', message }
}

/** Narrow the provider result to the review protocol. */
function readReview(result: SubagentResult): CompletionReview | undefined {
  if (result.stopReason !== 'completed' || typeof result.structured !== 'object' || result.structured === null) return undefined
  const value = result.structured as Record<string, unknown>
  const status = value.status
  const message = value.message
  if ((status !== 'complete' && status !== 'incomplete') || typeof message !== 'string') return undefined
  if (status === 'incomplete' && message.trim() === '') return undefined
  return { status, message }
}

/** Build the plugin-sourced user message that steers the parent into another step. */
function continuationMessage(message: string) {
  return createUserMessage({
    content: [{ type: 'text', text: `The completion review found unfinished work. Continue the task and address these changes before replying:\n\n${message}` }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'completion review requested changes' },
  })
}

/** Ask the parent to use the visible completion-check tool before replying. */
function checkRequestMessage() {
  return createUserMessage({
    content: [{ type: 'text', text: 'Before replying to the user, call the `completion_check` tool and wait for its result.' }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'completion check required' },
  })
}

/** Render the completion-check tool result for the parent model and user UI. */
function renderReview(review: CompletionReview): ContentBlock[] {
  if (review.status === 'complete') {
    return [{ type: 'text', text: 'Completion check passed. The request is complete.' }]
  }
  if (review.status === 'unavailable') {
    return [{ type: 'text', text: `Completion check could not obtain a valid reviewer result. Continue without treating the review as passed.\n\n${review.message}` }]
  }
  return [{ type: 'text', text: `Completion check found unfinished work. Continue with these changes:\n\n${review.message}` }]
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
  const maxAttempts = config.maxAttempts ?? DEFAULT_COMPLETION_CHECKER_MAX_ATTEMPTS

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
      if (state.review.status === 'incomplete') agent.steer(continuationMessage(state.review.message))
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
        schema: COMPLETION_REVIEW_SCHEMA,
        render: (_args, value) => renderReview(value as unknown as CompletionReview),
      },
      async execute(_args, exec) {
        const parent = exec.agent
        if (parent === undefined) throw new Error('completion_check requires a calling agent')
        if (!source().enabled) throw new Error('completion checker is disabled')
        if (isNestedAgent(parent)) throw new Error('completion_check is unavailable inside a reviewer subagent')
        const turn = parent.session.events.findLast(event => event.type === 'turn/start')
        if (turn === undefined) throw new Error('completion_check requires an active agent turn')
        const previous = reviewStates.get(parent)
        if (previous?.turn === turn.data.turn && previous.review.status === 'unavailable') return previous.review
        try {
          let lastResult: SubagentResult | undefined
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let run: SubagentRun | undefined
            try {
              run = await ctx.subagents.start(providerName, {
                label: 'completion-checker',
                prompt: [{ type: 'text', text: `${reviewAttemptPrompt(parent, turn.data.turn, attempt)}\nDo not call the completion_check tool; return only your structured review.` }],
                parent,
                signal: exec.signal,
                outputSchema: COMPLETION_REVIEW_SCHEMA,
                toolFilter: { deny: ['completion_check'] },
              })
              lastResult = await run.result
              const review = readReview(lastResult)
              if (review !== undefined) {
                reviewStates.set(parent, { turn: turn.data.turn, review })
                return review
              }
            } finally {
              if (run !== undefined) await run.dispose()
            }
          }
          const stopReason = lastResult?.stopReason === undefined ? 'unknown' : lastResult.stopReason
          const review = unavailableReview(`The reviewer returned no valid structured result after ${maxAttempts} attempt(s) (last stop reason: ${stopReason}).`)
          reviewStates.set(parent, { turn: turn.data.turn, review })
          return review
        } catch (error: unknown) {
          if (exec.signal.aborted) throw error
          const review = unavailableReview(`The reviewer failed before producing a valid structured result: ${String(error)}`)
          reviewStates.set(parent, { turn: turn.data.turn, review })
          return review
        }
      },
    }
    disposeTool = ctx.tools.register(tool)
    disposePrompt = ctx.systemPrompt.section({
      name: 'tool:completion-check',
      order: 197,
      text: ({ agent }) => agent === undefined || isNestedAgent(agent)
        ? ''
        : 'Before giving a final answer, you MUST call the `completion_check` tool. If it reports unfinished work, make the requested changes and call `completion_check` again before replying.',
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
