import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as CompletionChecker from '@deepseek-ai/dsh-completion-checker'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as ForkProvider from '@deepseek-ai/dsh-subagent-fork-in-process'
import type { SubagentStartRequest, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { maxTokensResponse, MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

interface ReviewHarness {
  readonly ctx: Context
  readonly agent: Agent
  readonly starts: SubagentStartRequest[]
  readonly disposes: ReturnType<typeof vi.fn>[]
}

interface HarnessOptions {
  readonly loopRecoveryNotice?: boolean
  readonly loopRetryNotice?: boolean
  readonly largeCurrentTurnMessage?: boolean
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
})

/** Mount the real loop with a deterministic subagent seam. */
async function harness(
  reviews: unknown[],
  config: CompletionChecker.Config = {},
  options: HarnessOptions = {},
): Promise<ReviewHarness> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const starts: SubagentStartRequest[] = []
  const disposes: ReturnType<typeof vi.fn>[] = []
  ctx.provide('subagents', {
    getProvider: () => ({}),
    start: async (_provider: string, request: SubagentStartRequest): Promise<SubagentRun> => {
      starts.push(request)
      const dispose = vi.fn(async () => {})
      disposes.push(dispose)
      const structured = reviews.shift()
      const result: SubagentResult = {
        output: [],
        structured,
        stopReason: 'completed',
      }
      return {
        id: SessionId(`review-${starts.length}`),
        localAgent: undefined,
        result: Promise.resolve(result),
        dispose,
      }
    },
  } as never)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.loopRecoveryNotice || options.loopRetryNotice || options.largeCurrentTurnMessage) {
    ctx.on('agent/turn-stopping', ({ agent: subject }) => {
      const recovery = options.loopRecoveryNotice
      const retry = options.loopRetryNotice
      const text = options.largeCurrentTurnMessage
        ? 'x'.repeat(200000)
        : recovery
          ? 'Repeated model output detected. Compacting context before retrying…'
          : retry
            ? 'Please stop. Explain the current status and what is missing.'
            : 'Repeated model output detected. Compacting context before retrying…'
      subject.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: 'agent-loop',
          form: 'notice',
          summary: options.largeCurrentTurnMessage
            ? 'large test notice'
            : recovery
              ? 'compacting after repeated loop'
              : retry
                ? 'LLM loop detected × 3'
                : 'compacting after repeated loop',
        },
      }), { surfaceOp: 'append' })
    })
  }
  await ctx.plugin(CompletionChecker, config)
  const adapter = new MockAdapter(Array.from(
    { length: Math.max(1, reviews.length) },
    (_, index) => textResponse(index === 0 ? 'answer' : 'continued answer'),
  ))
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, starts, disposes }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const off = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        off()
        resolve()
      }
    })
  })
}

function start(agent: Agent): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do the requested work' }], source: { kind: 'user' } }))
}

describe('completion-checker', () => {
  it('reviews the completed turn with structured output and lets complete work stop', async () => {
    const { ctx, agent, starts, disposes } = await harness([{ status: 'complete', message: '' }])
    start(agent)
    await waitForIdle(ctx, agent)

    expect(starts).toHaveLength(1)
    expect(starts[0]?.ephemeral).toBe(true)
    expect(starts[0]!.prompt[0]).toMatchObject({ type: 'text' })
    expect((starts[0]!.prompt[0] as { type: 'text'; text: string }).text).toContain('answer')
    expect(starts[0]!.outputSchema).toMatchObject({
      type: 'object',
      required: ['status', 'message'],
    })
    expect(disposes[0]).toHaveBeenCalledOnce()
    expect(agent.session.events.filter(event =>
      event.type === 'user/message' && event.data.source.kind === 'plugin')).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/end')).toHaveLength(1)
  })

  it('steers the parent with the review message when work remains', async () => {
    const { ctx, agent, starts } = await harness([
      { status: 'incomplete', message: 'Verify the generated file before answering.' },
      { status: 'complete', message: '' },
    ])
    // The mock response is enough for the continuation step; the first review
    // must still be the source of the durable plugin notice.
    start(agent)
    await waitForIdle(ctx, agent)

    expect(starts).toHaveLength(2)
    const notices = agent.session.events.filter(event =>
      event.type === 'user/message' && event.data.source.kind === 'plugin')
    expect(notices).toHaveLength(3)
    expect(notices[0]).toMatchObject({
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'Double-checking results before stopping…' }] },
    })
    expect(notices[1]).toMatchObject({
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'Verify the generated file before answering.' }] },
    })
    expect(notices[2]).toMatchObject({
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'Double-checking results before stopping…' }] },
    })
    expect(agent.session.events.filter(event => event.type === 'turn/end')).toHaveLength(1)
  })

  it('does not review when disabled', async () => {
    const { ctx, agent, starts } = await harness([], { enabled: false })
    start(agent)
    await waitForIdle(ctx, agent)

    expect(starts).toHaveLength(0)
  })

  it('does not review a turn already being recovered by the loop guard', async () => {
    const { ctx, agent, starts } = await harness([{ status: 'complete', message: '' }], {}, { loopRecoveryNotice: true })
    start(agent)
    await waitForIdle(ctx, agent)

    expect(starts).toHaveLength(0)
  })

  it('reviews the third loop-retry prompt after the model stops', async () => {
    const { ctx, agent, starts } = await harness([{ status: 'complete', message: '' }], {}, { loopRetryNotice: true })
    start(agent)
    await waitForIdle(ctx, agent)

    expect(starts).toHaveLength(1)
  })

  it('bounds the current-turn review context', async () => {
    const { ctx, agent, starts } = await harness([{ status: 'complete', message: '' }], {}, { largeCurrentTurnMessage: true })
    start(agent)
    await waitForIdle(ctx, agent)

    const prompt = starts[0]?.prompt[0]
    expect(prompt).toMatchObject({ type: 'text' })
    const text = (prompt as { type: 'text'; text: string }).text
    expect(text.length).toBeLessThan(14000)
    expect(text).toContain('[truncated]')
  })

  it('fails open for an invalid reviewer result', async () => {
    const { ctx, agent, starts } = await harness([{ status: 'incomplete', message: '' }])
    start(agent)
    await waitForIdle(ctx, agent)

    expect(starts).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/end')).toHaveLength(1)
  })

  it('does not review a token-limited turn', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    const starts: SubagentStartRequest[] = []
    ctx.provide('subagents', { getProvider: () => ({}), start: async (_p: string, request: SubagentStartRequest) => {
      starts.push(request)
      return { id: SessionId('review'), localAgent: undefined, result: Promise.resolve({ output: [], stopReason: 'completed' as const }), dispose: async () => {} }
    } } as never)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(CompletionChecker)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([maxTokensResponse('partial')]))
    const agent = ctx.agentLoop.create(SessionId('limited'), { provider: 'mock', model: 'mock' })
    start(agent)
    await waitForIdle(ctx, agent)

    expect(starts).toHaveLength(0)
  })

  it('launches the real fork provider and captures the structured review', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(CompletionChecker)
    // The shipped loader may activate both plugins against the same service
    // in this order; the checker must attach when the provider is added later.
    await ctx.plugin(ForkProvider, { providerName: 'fork' })
    const adapter = new MockAdapter([
      textResponse('answer'),
      toolCallResponse('review', 'structured_output', { status: 'complete', message: '' }),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('real-fork-parent'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    expect(ctx.agents.list()).toEqual([agent])
    expect(ctx.sessions.list()).toEqual([agent.session])
    expect(agent.session.events.filter(event =>
      event.type === 'user/message' && event.data.source.kind === 'plugin')).toMatchObject([
      { data: { source: { plugin: 'completion-checker' } } },
    ])
  })
})
