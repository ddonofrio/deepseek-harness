/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-token-limit-handler`.
 * @module @deepseek-ai/dsh-token-limit-handler/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-token-limit-handler'

/** Cordis companion plugin name. */
export const name = 'token-limit-handler-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the handler's recovery count is private to its listener
 * and its only durable output is the agent-owned `user/message` record.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
