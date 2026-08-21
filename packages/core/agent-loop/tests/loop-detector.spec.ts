import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { detectTokenLoop, loopTextForChunk, tokenizeLoopText } from '../src/loop-detector.ts'

describe('detectTokenLoop', () => {
  it('detects a triple repeated suffix and returns its coordinates', () => {
    const tokens = ['before', 'a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e']
    expect(detectTokenLoop(tokens)).toEqual({
      start: 1,
      length: 5,
      block: ['a', 'b', 'c', 'd', 'e'],
    })
  })

  it('does not classify a double repetition or a short block as a loop', () => {
    expect(detectTokenLoop(['a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e'])).toBeUndefined()
    expect(detectTokenLoop(['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd', 'a', 'b', 'c', 'd'])).toBeUndefined()
  })

  it('tokenizes text consistently across words and punctuation', () => {
    expect(tokenizeLoopText('One, two! One, two!')).toEqual(['One', ',', 'two', '!', 'One', ',', 'two', '!'])
  })

  it('collects reasoning and tool-call content without duplicating block-end content', () => {
    const deltaIndexes = new Set<number>()
    expect(loopTextForChunk({ type: 'reasoning-delta', index: 0, text: 'thinking' }, deltaIndexes)).toBe('thinking')
    expect(loopTextForChunk({ type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking' } }, deltaIndexes)).toBeUndefined()
    expect(loopTextForChunk({
      type: 'tool-call-delta', index: 1, id: CallId('call-1'), name: 'read', argumentsDelta: '{"path":"x"}',
    }, deltaIndexes)).toBe('read{"path":"x"}')
    expect(loopTextForChunk({
      type: 'block-end', index: 2, block: { type: 'tool-call', id: CallId('call-2'), name: 'read', arguments: '{"path":"x"}' },
    }, deltaIndexes)).toBe('read{"path":"x"}')
  })
})
