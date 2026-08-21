/** The agent-loop card's staged form over the `agent-loop` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  booleanField, CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the agent loop's user-owned settings. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const AGENT_LOOP_NS = 'agent-loop'

/**
 * The agent-loop fields this card edits. The Host section carries only this
 * field — the composed `agents` array is deliberately not part of it.
 */
export interface AgentLoopSettings {
  /** Upper bound on parallel-safe tool calls in flight per step. */
  maxParallelToolCalls?: number
  /** General loop-recovery policy. */
  loopDetectionEnabled?: boolean
  loopDetectionIncludeLoop?: boolean
  loopDetectionMinTokens?: number
  loopDetectionFirstPrompt?: string
  loopDetectionSecondPrompt?: string
  loopDetectionThirdPrompt?: string
}

/** What the agent-loop card renders. */
export interface AgentLoopCardState extends CardShell {
  /** Parallel tool-call cap. */
  maxParallelToolCalls: CardFieldState
}

/** The registration-side face the agent-loop card's slot entry injects. */
export interface AgentLoopCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useAgentLoopCard. */
    agentLoopCard: SnapshotStore<AgentLoopCardState>
  }
}

/** Bridges the `agent-loop` scope onto the card's staged form. */
export class AgentLoopCardController {
  private readonly form: CardForm<AgentLoopSettings>
  private readonly store: SnapshotStore<AgentLoopCardState>

  /** @param scope - the bound settings scope for the `agent-loop` namespace. */
  constructor(scope: SettingsScope<AgentLoopSettings>) {
    this.form = new CardForm(scope, [numberField('maxParallelToolCalls')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): AgentLoopCardState {
    return { ...this.form.shell(), maxParallelToolCalls: this.form.field('maxParallelToolCalls') }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): AgentLoopCardFace {
    return { hooks: { agentLoopCard: this.store }, ...this.form.actions() }
  }
}

/** General-settings projection for the loop recovery policy. */
export interface LoopDetectionRowState extends CardShell {
  enabled: CardFieldState
  includeLoop: CardFieldState
  minTokens: CardFieldState
  firstPrompt: CardFieldState
  secondPrompt: CardFieldState
  thirdPrompt: CardFieldState
}

/** Registration-side face injected into the General settings row. */
export interface LoopDetectionRowFace extends CardActions {
  hooks: {
    loopDetection: SnapshotStore<LoopDetectionRowState>
  }
}

/** Bridges the loop policy fields onto the General settings row. */
export class LoopDetectionRowController {
  private readonly form: CardForm<AgentLoopSettings>
  private readonly store: SnapshotStore<LoopDetectionRowState>

  constructor(scope: SettingsScope<AgentLoopSettings>) {
    this.form = new CardForm(scope, [
      booleanField('loopDetectionEnabled'),
      booleanField('loopDetectionIncludeLoop'),
      numberField('loopDetectionMinTokens'),
      textField('loopDetectionFirstPrompt'),
      textField('loopDetectionSecondPrompt'),
      textField('loopDetectionThirdPrompt'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): LoopDetectionRowState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('loopDetectionEnabled'),
      includeLoop: this.form.field('loopDetectionIncludeLoop'),
      minTokens: this.form.field('loopDetectionMinTokens'),
      firstPrompt: this.form.field('loopDetectionFirstPrompt'),
      secondPrompt: this.form.field('loopDetectionSecondPrompt'),
      thirdPrompt: this.form.field('loopDetectionThirdPrompt'),
    }
  }

  /**
   * Build the injected face consumed by the General settings row.
   * @returns the row snapshot and staged-form actions.
   */
  inject(): LoopDetectionRowFace {
    return { hooks: { loopDetection: this.store }, ...this.form.actions() }
  }
}
