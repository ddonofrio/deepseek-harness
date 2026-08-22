import { describe, expect, it } from 'vitest'
import { displayFailureMessage } from '../src/client/sessions/failure-display.ts'

describe('displayFailureMessage', () => {
  it('does not expose provider context-overflow details', () => {
    expect(displayFailureMessage({
      code: 'CONTEXT_WINDOW_EXCEEDED',
      message: 'Message too long: 131086 tokens exceeds the 131072-token context window.',
    })).toBe('The conversation is too large to continue. Start a new conversation.')
  })
})
