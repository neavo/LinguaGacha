import { AlertCircle, LoaderCircle } from 'lucide-react'

import type { ScreenComponentProps } from '@/app/navigation/types'
import { useI18n } from '@/i18n'
import '@/pages/laboratory-page/laboratory-page.css'
import { useLaboratoryPageState } from '@/pages/laboratory-page/use-laboratory-page-state'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/shadcn/alert'
import { Button } from '@/shadcn/button'
import { SettingHelpButton } from '@/widgets/setting-help-button/setting-help-button'
import { SettingCardRow } from '@/widgets/setting-card-row/setting-card-row'
import { SegmentedToggle } from '@/widgets/segmented-toggle/segmented-toggle'

type LaboratoryHelpField = 'mtool_optimizer_enable' | 'force_thinking_enable'

const HELP_URL_BY_FIELD = {
  'zh-CN': {
    mtool_optimizer_enable: 'https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer',
    force_thinking_enable: 'https://github.com/neavo/LinguaGacha/wiki/ForceThinking',
  },
  'en-US': {
    mtool_optimizer_enable: 'https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN',
    force_thinking_enable: 'https://github.com/neavo/LinguaGacha/wiki/ForceThinkingEN',
  },
} as const satisfies Record<'zh-CN' | 'en-US', Record<LaboratoryHelpField, string>>

export function LaboratoryPage(props: ScreenComponentProps): JSX.Element {
  const { locale, t } = useI18n()
  const laboratory_page_state = useLaboratoryPageState()
  const boolean_segmented_options = [
    {
      value: 'disabled',
      label: t('app.toggle.disabled'),
    },
    {
      value: 'enabled',
      label: t('app.toggle.enabled'),
    },
  ] as const

  function render_help_button(field: LaboratoryHelpField): JSX.Element {
    const help_url = HELP_URL_BY_FIELD[locale][field]

    return (
      <SettingHelpButton
        url={help_url}
        aria_label={t(`laboratory_page.fields.${field}.help_label`)}
        className="laboratory-page__help-button"
      />
    )
  }

  function render_boolean_toggle(options: {
    title_key:
      | 'laboratory_page.fields.mtool_optimizer_enable.title'
      | 'laboratory_page.fields.force_thinking_enable.title'
    value: boolean
    disabled: boolean
    on_value_change: (next_value: boolean) => void
  }): JSX.Element {
    return (
      <SegmentedToggle
        aria_label={t(options.title_key)}
        size="sm"
        value={options.value ? 'enabled' : 'disabled'}
        options={boolean_segmented_options}
        stretch
        disabled={options.disabled}
        on_value_change={(next_value) => {
          options.on_value_change(next_value === 'enabled')
        }}
      />
    )
  }

  return (
    <div
      className="laboratory-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      {laboratory_page_state.refresh_error !== null
        ? (
            <Alert variant="destructive" className="laboratory-page__notice">
              <AlertCircle />
              <AlertTitle>{t('laboratory_page.feedback.refresh_failed_title')}</AlertTitle>
              <AlertDescription>{laboratory_page_state.refresh_error}</AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={laboratory_page_state.is_refreshing}
                  onClick={() => {
                    void laboratory_page_state.refresh_snapshot()
                  }}
                >
                  {laboratory_page_state.is_refreshing
                    ? (
                        <>
                          <LoaderCircle className="animate-spin" data-icon="inline-start" />
                          {t('app.action.loading')}
                        </>
                      )
                    : t('laboratory_page.feedback.retry')}
                </Button>
              </AlertAction>
            </Alert>
          )
        : null}

      <section className="laboratory-page__list" aria-label={t('laboratory_page.title')}>
        <SettingCardRow
          title={t('laboratory_page.fields.mtool_optimizer_enable.title')}
          title_suffix={render_help_button('mtool_optimizer_enable')}
          description={t('laboratory_page.fields.mtool_optimizer_enable.description')}
          action={(
            render_boolean_toggle({
              title_key: 'laboratory_page.fields.mtool_optimizer_enable.title',
              value: laboratory_page_state.snapshot.mtool_optimizer_enable,
              disabled: laboratory_page_state.is_task_busy || laboratory_page_state.pending_state.mtool_optimizer_enable,
              on_value_change: (next_value) => {
                void laboratory_page_state.update_mtool_optimizer_enable(next_value)
              },
            })
          )}
        />

        <SettingCardRow
          title={t('laboratory_page.fields.force_thinking_enable.title')}
          title_suffix={render_help_button('force_thinking_enable')}
          description={t('laboratory_page.fields.force_thinking_enable.description')}
          action={(
            render_boolean_toggle({
              title_key: 'laboratory_page.fields.force_thinking_enable.title',
              value: laboratory_page_state.snapshot.force_thinking_enable,
              disabled: laboratory_page_state.is_task_busy || laboratory_page_state.pending_state.force_thinking_enable,
              on_value_change: (next_value) => {
                void laboratory_page_state.update_force_thinking_enable(next_value)
              },
            })
          )}
        />
      </section>
    </div>
  )
}
