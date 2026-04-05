import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useMemo } from 'react'

import { useI18n } from '@/i18n'
import '@/pages/basic-settings-page/basic-settings-page.css'
import '@/widgets/setting-card-row/setting-card-row.css'
import {
  ALL_LANGUAGE_VALUE,
  LANGUAGE_CODES,
  LANGUAGE_LABEL_KEYS,
  PROJECT_SAVE_MODE,
  PROJECT_SAVE_MODE_LABEL_KEYS,
  REQUEST_TIMEOUT_MAX,
  REQUEST_TIMEOUT_MIN,
  is_project_save_mode,
} from '@/pages/basic-settings-page/types'
import { useBasicSettingsState } from '@/pages/basic-settings-page/use-basic-settings-state'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { SettingCardRow } from '@/widgets/setting-card-row/setting-card-row'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

type BasicSettingsPageProps = {
  is_sidebar_collapsed: boolean
}

const OUTPUT_FOLDER_TOGGLE_VALUE = {
  DISABLED: 'disabled',
  ENABLED: 'enabled',
} as const

function replace_placeholder(template: string, value: string): string {
  return template.replace('{PATH}', value)
}

export function BasicSettingsPage(props: BasicSettingsPageProps): JSX.Element {
  const { t } = useI18n()
  const basic_settings_state = useBasicSettingsState()

  const source_language_options = useMemo(() => {
    return [
      {
        value: ALL_LANGUAGE_VALUE,
        label: t(LANGUAGE_LABEL_KEYS.ALL),
      },
      ...LANGUAGE_CODES.map((language_code) => {
        return {
          value: language_code,
          label: t(LANGUAGE_LABEL_KEYS[language_code]),
        }
      }),
    ]
  }, [t])

  const target_language_options = useMemo(() => {
    return LANGUAGE_CODES.map((language_code) => {
      return {
        value: language_code,
        label: t(LANGUAGE_LABEL_KEYS[language_code]),
      }
    })
  }, [t])

  const project_save_mode_options = useMemo(() => {
    return [
      PROJECT_SAVE_MODE.MANUAL,
      PROJECT_SAVE_MODE.FIXED,
      PROJECT_SAVE_MODE.SOURCE,
    ].map((mode) => {
      return {
        value: mode,
        label: t(PROJECT_SAVE_MODE_LABEL_KEYS[mode]),
      }
    })
  }, [t])

  const project_save_mode_description = basic_settings_state.snapshot.project_save_mode === PROJECT_SAVE_MODE.FIXED
    && basic_settings_state.snapshot.project_fixed_path !== ''
    ? replace_placeholder(
        t('setting.page.basic.fields.project_save_mode.description_fixed'),
        basic_settings_state.snapshot.project_fixed_path,
      )
    : t('setting.page.basic.fields.project_save_mode.description')

  const language_locked = basic_settings_state.is_task_busy
  const output_folder_toggle_value = basic_settings_state.snapshot.output_folder_open_on_finish
    ? OUTPUT_FOLDER_TOGGLE_VALUE.ENABLED
    : OUTPUT_FOLDER_TOGGLE_VALUE.DISABLED

  return (
    <div
      className="basic-settings-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      {basic_settings_state.refresh_error !== null
        ? (
            <Alert variant="destructive" className="basic-settings-page__notice">
              <AlertCircle />
              <AlertTitle>{t('setting.page.basic.feedback.refresh_failed_title')}</AlertTitle>
              <AlertDescription>{basic_settings_state.refresh_error}</AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={basic_settings_state.is_refreshing}
                  onClick={() => {
                    void basic_settings_state.refresh_snapshot()
                  }}
                >
                  {basic_settings_state.is_refreshing
                    ? (
                        <>
                          <LoaderCircle className="animate-spin" data-icon="inline-start" />
                          {t('common.action.loading')}
                        </>
                      )
                    : t('setting.page.basic.feedback.retry')}
                </Button>
              </AlertAction>
            </Alert>
          )
        : null}

      <section className="basic-settings-page__list" aria-label={t('setting.page.basic.title')}>
        <SettingCardRow
          title={t('setting.page.basic.fields.source_language.title')}
          description={t('setting.page.basic.fields.source_language.description')}
          action={(
            <Select
              value={basic_settings_state.snapshot.source_language}
              disabled={language_locked || basic_settings_state.pending_state.source_language}
              onValueChange={(next_value) => {
                void basic_settings_state.update_source_language(next_value)
              }}
            >
              <SelectTrigger className="basic-settings-page__select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {source_language_options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        />

        <SettingCardRow
          title={t('setting.page.basic.fields.target_language.title')}
          description={t('setting.page.basic.fields.target_language.description')}
          action={(
            <Select
              value={basic_settings_state.snapshot.target_language}
              disabled={language_locked || basic_settings_state.pending_state.target_language}
              onValueChange={(next_value) => {
                void basic_settings_state.update_target_language(next_value)
              }}
            >
              <SelectTrigger className="basic-settings-page__select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {target_language_options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        />

        <SettingCardRow
          title={t('setting.page.basic.fields.project_save_mode.title')}
          description={project_save_mode_description}
          action={(
            <Select
              value={basic_settings_state.snapshot.project_save_mode}
              disabled={basic_settings_state.pending_state.project_save_mode}
              onValueChange={(next_value) => {
                if (is_project_save_mode(next_value)) {
                  void basic_settings_state.update_project_save_mode(next_value)
                }
              }}
            >
              <SelectTrigger className="basic-settings-page__select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {project_save_mode_options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        />

        <SettingCardRow
          title={t('setting.page.basic.fields.output_folder_open_on_finish.title')}
          description={t('setting.page.basic.fields.output_folder_open_on_finish.description')}
          action={(
            <ToggleGroup
              type="single"
              variant="segmented"
              className="basic-settings-page__toggle-group"
              aria-label={t('setting.page.basic.fields.output_folder_open_on_finish.title')}
              value={output_folder_toggle_value}
              disabled={basic_settings_state.pending_state.output_folder_open_on_finish}
              onValueChange={(next_value) => {
                if (next_value === OUTPUT_FOLDER_TOGGLE_VALUE.DISABLED) {
                  void basic_settings_state.update_output_folder_open_on_finish(false)
                } else if (next_value === OUTPUT_FOLDER_TOGGLE_VALUE.ENABLED) {
                  void basic_settings_state.update_output_folder_open_on_finish(true)
                }
              }}
            >
              <ToggleGroupItem
                className="basic-settings-page__toggle-item"
                value={OUTPUT_FOLDER_TOGGLE_VALUE.DISABLED}
              >
                {t('setting.page.basic.fields.output_folder_open_on_finish.options.disabled')}
              </ToggleGroupItem>
              <ToggleGroupItem
                className="basic-settings-page__toggle-item"
                value={OUTPUT_FOLDER_TOGGLE_VALUE.ENABLED}
              >
                {t('setting.page.basic.fields.output_folder_open_on_finish.options.enabled')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />

        <SettingCardRow
          title={t('setting.page.basic.fields.request_timeout.title')}
          description={t('setting.page.basic.fields.request_timeout.description')}
          action={(
            <div className="basic-settings-page__number-field">
              <Input
                className="basic-settings-page__number-input"
                type="number"
                min={REQUEST_TIMEOUT_MIN}
                max={REQUEST_TIMEOUT_MAX}
                value={basic_settings_state.snapshot.request_timeout}
                disabled={basic_settings_state.pending_state.request_timeout}
                onChange={(event) => {
                  void basic_settings_state.update_request_timeout(Number(event.target.value))
                }}
              />
            </div>
          )}
        />
      </section>
    </div>
  )
}
