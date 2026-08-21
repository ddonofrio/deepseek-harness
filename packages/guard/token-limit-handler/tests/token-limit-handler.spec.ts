import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as TokenLimitHandler from '@deepseek-ai/dsh-token-limit-handler'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { maxTokensResponse, MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Mount the real agent loop with the token-limit policy. */
async function harness(config: TokenLimitHandler.Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenLimitHandler, config)
  return ctx
}

/** Wait for one agent to settle its current activity. */
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

/** Read plugin-generated recovery messages from the durable session log. */
function recoveryMessages(agent: Agent): string[] {
  return agent.session.events
    .filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source.kind === 'plugin')
    .map(event => event.data.content.map(block => block.type === 'text' ? block.text : '').join(''))
}

function start(agent: Agent): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
}

describe('token-limit-handler', () => {
  it('continues five times by default, then preserves the terminal max-tokens result', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter(Array.from({ length: 6 }, (_, i) => maxTokensResponse(`part-${i}`)))
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('default'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)

    expect(recoveryMessages(agent)).toEqual(['continue', 'continue', 'continue', 'continue', 'continue'])
    expect(agent.session.events.filter(event => event.type === 'turn/end').at(-1)?.data).toMatchObject({
      reason: { kind: 'max-tokens' },
    })
    expect(adapter.requests).toHaveLength(6)
  })

  it('stops without steering when configured with stop', async () => {
    const ctx = await harness({ action: 'stop' })
    const adapter = new MockAdapter([maxTokensResponse('partial')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('stop'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)

    expect(recoveryMessages(agent)).toEqual([])
    expect(adapter.requests).toHaveLength(1)
  })

  it('sends a custom prompt on each limit and resets the chain after a normal response', async () => {
    const ctx = await harness({ action: 'custom-prompt', customPrompt: 'finish the answer in fewer words' })
    const adapter = new MockAdapter([
      maxTokensResponse('first'),
      textResponse('done'),
      maxTokensResponse('second'),
      textResponse('done again'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('custom'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(recoveryMessages(agent)).toEqual(['finish the answer in fewer words', 'finish the answer in fewer words'])
    expect(adapter.requests).toHaveLength(4)
  })

  it('rejects an empty custom prompt when that action is selected', async () => {
    const ctx = await harness()
    await expect(ctx.plugin(TokenLimitHandler, { action: 'custom-prompt' })).rejects.toThrow(/customPrompt must not be empty/)
  })
})
