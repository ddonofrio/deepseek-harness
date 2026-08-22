/**
 * Convert a durable failure into copy that is safe to expose in the GUI.
 * @param failure - Failure value preserved by the session event.
 * @returns Display-safe copy for client projections.
 */
export function displayFailureMessage(failure: unknown): string {
  if (failure === null || typeof failure !== 'object') return String(failure)
  const record = failure as { code?: unknown; message?: unknown }
  // Provider AUTH messages may echo a masked or partially preserved credential.
  // Keep the raw diagnostic in the session log, but never project it into UI state.
  if (record.code === 'AUTH') return 'API key is invalid'
  if (record.code === 'CONTEXT_WINDOW_EXCEEDED') {
    return 'The conversation is too large to continue. Start a new conversation.'
  }
  return typeof record.message === 'string' ? record.message : JSON.stringify(failure)
}
