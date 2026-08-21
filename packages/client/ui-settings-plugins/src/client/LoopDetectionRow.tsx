/** General Settings row for the agent's LLM loop recovery policy. */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SelectField, TextAreaField, ValueField } from './fields.tsx'
import type { LoopDetectionRowFace } from './agent-loop-card-controller.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './LoopDetectionRow.module.css'

/** Full General-settings row props. */
export type LoopDetectionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<LoopDetectionRowFace>

/** Render the loop policy below the Composer busy-Enter preference. */
export function LoopDetectionRow(props: LoopDetectionRowProps) {
  const { t } = props
  const state = props.useLoopDetection(snapshot => snapshot)
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
          <span className={css.title}>{field('loopDetectionTitle')}</span>
          <span className={css.desc}>{field('loopDetectionDescription')}</span>
        </span>
        <span className={css.status}>{enabled ? field('loopDetectionOn') : field('loopDetectionOff')}</span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>
      {open
        ? (
          <div className={css.body}>
            {!state.writable ? <p className={css.readOnly}>{t('readOnly')}</p> : null}
            <SelectField
              id="general-loop-detection-enabled"
              label={field('loopDetectionEnabled')}
              hint={field('loopDetectionDescription')}
              options={[
                { value: 'off', label: field('loopDetectionOff') },
                { value: 'on', label: field('loopDetectionOn') },
              ]}
              {...common}
              {...state.enabled}
              onEdit={(text) => { props.edit('loopDetectionEnabled', text) }}
              onReset={() => { props.resetField('loopDetectionEnabled') }}
            />
            {enabled
              ? (
                <>
                  <SelectField
                    id="general-loop-detection-include"
                    label={field('loopDetectionIncludeLoop')}
                    hint={field('loopDetectionPromptHint')}
                    options={[
                      { value: 'on', label: field('loopDetectionYes') },
                      { value: 'off', label: field('loopDetectionNo') },
                    ]}
                    {...common}
                    {...state.includeLoop}
                    onEdit={(text) => { props.edit('loopDetectionIncludeLoop', text) }}
                    onReset={() => { props.resetField('loopDetectionIncludeLoop') }}
                  />
                  <ValueField
                    id="general-loop-detection-min-tokens"
                    label={field('loopDetectionMinTokens')}
                    hint={field('loopDetectionMinTokensHint')}
                    numeric
                    {...common}
                    {...state.minTokens}
                    onEdit={(text) => { props.edit('loopDetectionMinTokens', text) }}
                    onReset={() => { props.resetField('loopDetectionMinTokens') }}
                  />
                  <TextAreaField
                    id="general-loop-detection-first-prompt"
                    label={field('loopDetectionFirstPrompt')}
                    hint={field('loopDetectionPromptHint')}
                    {...common}
                    {...state.firstPrompt}
                    onEdit={(text) => { props.edit('loopDetectionFirstPrompt', text) }}
                    onReset={() => { props.resetField('loopDetectionFirstPrompt') }}
                  />
                  <TextAreaField
                    id="general-loop-detection-second-prompt"
                    label={field('loopDetectionSecondPrompt')}
                    hint={field('loopDetectionPromptHint')}
                    {...common}
                    {...state.secondPrompt}
                    onEdit={(text) => { props.edit('loopDetectionSecondPrompt', text) }}
                    onReset={() => { props.resetField('loopDetectionSecondPrompt') }}
                  />
                  <TextAreaField
                    id="general-loop-detection-third-prompt"
                    label={field('loopDetectionThirdPrompt')}
                    hint={field('loopDetectionPromptHint')}
                    {...common}
                    {...state.thirdPrompt}
                    onEdit={(text) => { props.edit('loopDetectionThirdPrompt', text) }}
                    onReset={() => { props.resetField('loopDetectionThirdPrompt') }}
                  />
                </>
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
