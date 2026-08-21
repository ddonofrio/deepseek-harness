/** General Settings row for output-token limit recovery. */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SelectField, TextAreaField, ValueField } from './fields.tsx'
import type { TokenLimitHandlerRowFace } from './token-limit-handler-controller.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './LoopDetectionRow.module.css'

/** Full General-settings row props. */
export type TokenLimitHandlerRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<TokenLimitHandlerRowFace>

/** Render the output-token recovery policy in General settings. */
export function TokenLimitHandlerRow(props: TokenLimitHandlerRowProps) {
  const { t } = props
  const state = props.useTokenLimitHandler(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const action = state.action.text
  const field = (key: PluginsSettingsLocaleKey) => t(key)
  const common = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    invalidLabel: t('invalidNumber'),
    disabled: !state.writable,
  }

  return (
    <div className={css.row}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.rowText}>
          <span className={css.title}>{field('tokenLimitHandlerTitle')}</span>
          <span className={css.desc}>{field('tokenLimitHandlerDescription')}</span>
        </span>
        <span className={css.status}>{field(action === 'stop' ? 'tokenLimitHandlerStop' : action === 'custom-prompt' ? 'tokenLimitHandlerCustom' : 'tokenLimitHandlerContinue')}</span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>
      {open
        ? (
          <div className={css.body}>
            {!state.writable ? <p className={css.readOnly}>{t('readOnly')}</p> : null}
            <SelectField
              id="general-token-limit-action"
              label={field('tokenLimitHandlerAction')}
              hint={field('tokenLimitHandlerActionHint')}
              options={[
                { value: 'continue', label: field('tokenLimitHandlerContinue') },
                { value: 'stop', label: field('tokenLimitHandlerStop') },
                { value: 'custom-prompt', label: field('tokenLimitHandlerCustom') },
              ]}
              {...common}
              {...state.action}
              onEdit={(text) => { props.edit('action', text) }}
              onReset={() => { props.resetField('action') }}
            />
            {action === 'continue'
              ? (
                <ValueField
                  id="general-token-limit-count"
                  label={field('tokenLimitHandlerContinueCount')}
                  hint={field('tokenLimitHandlerContinueCountHint')}
                  numeric
                  {...common}
                  {...state.continueCount}
                  onEdit={(text) => { props.edit('continueCount', text) }}
                  onReset={() => { props.resetField('continueCount') }}
                />
              )
              : null}
            {action === 'custom-prompt'
              ? (
                <TextAreaField
                  id="general-token-limit-prompt"
                  label={field('tokenLimitHandlerCustomPrompt')}
                  hint={field('tokenLimitHandlerCustomPromptHint')}
                  {...common}
                  {...state.customPrompt}
                  onEdit={(text) => { props.edit('customPrompt', text) }}
                  onReset={() => { props.resetField('customPrompt') }}
                />
              )
              : null}
            <div className={css.footer}>
              {state.failed ? <p className={css.failed}>{t('saveFailed')}</p> : null}
              <button type="button" className={css.discard} disabled={!state.dirty || state.saving} onClick={props.discard}>
                {t('discard')}
              </button>
              <button type="button" className={css.save} disabled={!state.dirty || state.invalid || state.saving} onClick={props.save}>
                {t(state.saving ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        )
        : null}
    </div>
  )
}
