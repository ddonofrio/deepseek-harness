/** The token-limit handler's staged General-settings form. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, numberField, textField, type CardActions, type CardFieldState } from './card-form.ts'

/** Namespace owned by the output-token recovery plugin. */
export const TOKEN_LIMIT_HANDLER_NS = 'token-limit-handler'

/** Fields exposed by the General row. */
export interface TokenLimitHandlerSettings {
  action?: string
  continueCount?: number
  customPrompt?: string
}

/** State rendered by the General row. */
export interface TokenLimitHandlerRowState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  action: CardFieldState
  continueCount: CardFieldState
  customPrompt: CardFieldState
}

/** Registration-side face for the General row. */
export interface TokenLimitHandlerRowFace extends CardActions {
  hooks: {
    tokenLimitHandler: SnapshotStore<TokenLimitHandlerRowState>
  }
}

/** Bridges the Host settings namespace onto the General row. */
export class TokenLimitHandlerRowController {
  private readonly form: CardForm<TokenLimitHandlerSettings>
  private readonly store: SnapshotStore<TokenLimitHandlerRowState>

  /** @param scope - the bound settings scope for the token-limit handler. */
  constructor(scope: SettingsScope<TokenLimitHandlerSettings>) {
    this.form = new CardForm(scope, [textField('action'), numberField('continueCount'), textField('customPrompt')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): TokenLimitHandlerRowState {
    return {
      ...this.form.shell(),
      action: this.form.field('action'),
      continueCount: this.form.field('continueCount'),
      customPrompt: this.form.field('customPrompt'),
    }
  }

  /**
   * Build the row face consumed by the slot registration.
   * @returns the snapshot store and staged form actions.
   */
  inject(): TokenLimitHandlerRowFace {
    return { hooks: { tokenLimitHandler: this.store }, ...this.form.actions() }
  }
}
