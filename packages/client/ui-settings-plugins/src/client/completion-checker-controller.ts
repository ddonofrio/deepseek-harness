/** The completion checker's staged General-settings form. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { booleanField, CardForm, type CardActions, type CardFieldState } from './card-form.ts'

/** Namespace owned by the completion checker. */
export const COMPLETION_CHECKER_NS = 'completion-checker'

/** Fields exposed by the General row. */
export interface CompletionCheckerSettings {
  enabled?: boolean
}

/** State rendered by the General row. */
export interface CompletionCheckerRowState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  enabled: CardFieldState
}

/** Registration-side face for the General row. */
export interface CompletionCheckerRowFace extends CardActions {
  hooks: {
    completionChecker: SnapshotStore<CompletionCheckerRowState>
  }
}

/** Bridges the Host settings namespace onto the General row. */
export class CompletionCheckerRowController {
  private readonly form: CardForm<CompletionCheckerSettings>
  private readonly store: SnapshotStore<CompletionCheckerRowState>

  /** @param scope - the bound settings scope for the completion checker. */
  constructor(scope: SettingsScope<CompletionCheckerSettings>) {
    this.form = new CardForm(scope, [booleanField('enabled')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): CompletionCheckerRowState {
    return { ...this.form.shell(), enabled: this.form.field('enabled') }
  }

  /**
   * Build the row face consumed by the slot registration.
   * @returns the snapshot store and staged form actions.
   */
  inject(): CompletionCheckerRowFace {
    return { hooks: { completionChecker: this.store }, ...this.form.actions() }
  }
}
