/** General Settings row for completion review. */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { CheckboxField } from './fields.tsx'
import type { CompletionCheckerRowFace } from './completion-checker-controller.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './LoopDetectionRow.module.css'

/** Full General-settings row props. */
export type CompletionCheckerRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<CompletionCheckerRowFace>

/** Render the completion-review toggle in General settings. */
export function CompletionCheckerRow(props: CompletionCheckerRowProps) {
  const { t } = props
  const state = props.useCompletionChecker(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const enabled = state.enabled.text === 'on'
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
          <span className={css.title}>{field('completionCheckerTitle')}</span>
          <span className={css.desc}>{field('completionCheckerDescription')}</span>
        </span>
        <span className={css.status}>{enabled ? field('completionCheckerOn') : field('completionCheckerOff')}</span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>
      {open
        ? (
          <div className={css.body}>
            {!state.writable ? <p className={css.readOnly}>{t('readOnly')}</p> : null}
            <CheckboxField
              id="general-completion-checker-enabled"
              label={field('completionCheckerEnabled')}
              hint={field('completionCheckerDescription')}
              {...common}
              {...state.enabled}
              onEdit={(text) => { props.edit('enabled', text) }}
              onReset={() => { props.resetField('enabled') }}
            />
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
