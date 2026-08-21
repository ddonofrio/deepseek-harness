/** Review a completed agent turn and continue it when the review finds unfinished work.
 *
 * The reviewer is a forked one-shot subagent. Forked history contains the
 * completed conversation prefix; this plugin also includes the turn currently
 * at `agent/turn-stopping`, because that turn has not reached `turn/end` yet.
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
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'

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

/** The default provider, which inherits the parent's completed conversation. */
export const DEFAULT_COMPLETION_CHECKER_PROVIDER = 'fork'

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

/** Load after the subagent registry so the review provider is available. */
export const inject = ['subagents']

/** Structured result required from the completion reviewer. */
const COMPLETION_REVIEW_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['complete', 'incomplete'] },
    message: { type: 'string' },
  },
  required: ['status', 'message'],
  additionalProperties: false,
}

type CompletionReview = { status: 'complete' | 'incomplete'; message: string }

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
    content: [{ type: 'text', text: message }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'completion review' },
  })
}

/** Build the durable status notice shown while the reviewer is running. */
function checkingMessage() {
  return createUserMessage({
    content: [{ type: 'text', text: 'Double-checking results before stopping…' }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'checking results' },
  })
}

/** Install the completion review at the terminal turn checkpoint. */
export function apply(ctx: Context, config: Config): void {
  const entry: CompletionCheckerSettings = {
    enabled: config.enabled ?? DEFAULT_COMPLETION_CHECKER_ENABLED,
  }
  let source: () => CompletionCheckerSettings = () => entry
  installSettingsSection(ctx, COMPLETION_CHECKER_SETTINGS_NAMESPACE, COMPLETION_CHECKER_SETTINGS_SCHEMA, entry, {
    setSource: (current) => { source = current },
    onChange: () => {},
  })

  const activeParents = new WeakSet<Agent>()
  const checkerAgents = new WeakSet<Agent>()
  const providerName = config.provider ?? DEFAULT_COMPLETION_CHECKER_PROVIDER

  // Provider plugins can register after this plugin even when both inject the
  // same `subagents` service. Mount the terminal listener when the configured
  // provider becomes available, matching the subagent tool's late-provider
  // registration behavior.
  let disposeTurnStopping: (() => void) | undefined
  const onTurnStopping = async ({ agent, turn, reason, signal }: TurnStoppingPayload) => {
    if (reason.kind !== 'completed' || !source().enabled || activeParents.has(agent) || checkerAgents.has(agent)) return
    if (isLoopRecoveryTurn(currentTurnEvents(agent, turn))) return
    const parentSession = agent.session.header.parentSession
    const parent = parentSession === undefined ? undefined : ctx.agents.get(parentSession)
    if (parent !== undefined && activeParents.has(parent)) return

    activeParents.add(agent)
    let run: SubagentRun | undefined
    try {
      signal.throwIfAborted()
      agent.session.append('user/message', checkingMessage(), { surfaceOp: 'append' })
      run = await ctx.subagents.start(providerName, {
        label: 'completion-checker',
        prompt: [{ type: 'text', text: reviewPrompt(agent, turn) }],
        parent: agent,
        signal,
        outputSchema: COMPLETION_REVIEW_SCHEMA,
        ephemeral: true,
      })
      if (run.localAgent !== undefined) checkerAgents.add(run.localAgent)
      const review = readReview(await run.result)
      if (review?.status === 'incomplete') {
        signal.throwIfAborted()
        agent.steer(continuationMessage(review.message))
      }
    } catch (error: unknown) {
      if (!signal.aborted) ctx.logger.warn(`completion-checker: review failed: ${String(error)}`)
    } finally {
      if (run?.localAgent !== undefined) checkerAgents.delete(run.localAgent)
      if (run !== undefined) {
        try {
          await run.dispose()
        } catch (error: unknown) {
          if (!signal.aborted) ctx.logger.warn(`completion-checker: reviewer disposal failed: ${String(error)}`)
        }
      }
      activeParents.delete(agent)
    }
  }

  const mount = () => {
    if (disposeTurnStopping !== undefined || ctx.subagents.getProvider(providerName) === undefined) return
    disposeTurnStopping = ctx.on('agent/turn-stopping', onTurnStopping)
  }
  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === providerName) mount()
  })
  ctx.on('subagent/provider-removed', (name) => {
    if (name !== providerName) return
    disposeTurnStopping?.()
    disposeTurnStopping = undefined
  })
  mount()
}

export const name = 'completion-checker'
