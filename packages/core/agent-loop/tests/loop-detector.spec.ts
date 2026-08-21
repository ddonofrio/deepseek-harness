import { describe, expect, it } from 'vitest'
import { detectTokenLoop, tokenizeLoopText } from '../src/loop-detector.ts'

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
})
