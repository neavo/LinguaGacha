import { AlertCircle, LoaderCircle } from 'lucide-react'

import type { ScreenComponentProps } from '@/app/navigation/types'
import { useI18n, type LocaleKey } from '@/i18n'
import '@/pages/laboratory-page/laboratory-page.css'
import { useLaboratoryPageState } from '@/pages/laboratory-page/use-laboratory-page-state'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/shadcn/alert'
import { Button } from '@/shadcn/button'
import { SettingHelpButton } from '@/widgets/setting-help-button/setting-help-button'
import { SettingCardRow } from '@/widgets/setting-card-row/setting-card-row'
import { SegmentedToggle } from '@/widgets/segmented-toggle/segmented-toggle'

type LaboratoryHelpField = 'mtool_optimizer_enable'

const HELP_URL_BY_FIELD = {
  'zh-CN': {
    mtool_optimizer_enable: 'https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer',
  },
  'en-US': {
    mtool_optimizer_enable: 'https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN',
  },
} as const satisfies Record<'zh-CN' | 'en-US', Record<LaboratoryHelpField, string>>

const HELP_LABEL_KEY_BY_FIELD: Record<LaboratoryHelpField, LocaleKey> = {
  mtool_optimizer_enable: 'laboratory_page.fields.mtool_optimizer_enable.help_label',
}

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
    const help_label_key = HELP_LABEL_KEY_BY_FIELD[field]

    return (
      <SettingHelpButton
        url={help_url}
        aria_label={t(help_label_key)}
        className="laboratory-page__help-button"
      />
    )
  }

  function render_boolean_toggle(options: {
    title_key: 'laboratory_page.fields.mtool_optimizer_enable.title'
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
      </section>
    </div>
  )
}
