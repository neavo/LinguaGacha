import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useState, type MouseEvent } from 'react'

import { useI18n } from '@/i18n'
import '@/pages/expert-settings-page/expert-settings-page.css'
import { useExpertSettingsState } from '@/pages/expert-settings-page/use-expert-settings-state'
import { PRECEDING_LINES_THRESHOLD_MAX, PRECEDING_LINES_THRESHOLD_MIN } from '@/pages/expert-settings-page/types'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/shadcn/alert'
import { Button } from '@/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/shadcn/dropdown-menu'
import { Input } from '@/shadcn/input'
import { SettingCardRow } from '@/widgets/setting-card-row/setting-card-row'
import { SegmentedToggle } from '@/widgets/segmented-toggle/segmented-toggle'

type ExpertSettingsPageProps = {
  is_sidebar_collapsed: boolean
}

export function ExpertSettingsPage(props: ExpertSettingsPageProps): JSX.Element {
  const { t } = useI18n()
  const expert_settings_state = useExpertSettingsState()
  const [is_response_check_menu_open, set_is_response_check_menu_open] = useState<boolean>(false)
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

  function render_boolean_toggle(options: {
    title_key:
      | 'expert_settings_page.fields.clean_ruby.title'
      | 'expert_settings_page.fields.deduplication_in_trans.title'
      | 'expert_settings_page.fields.deduplication_in_bilingual.title'
      | 'expert_settings_page.fields.write_translated_name_fields_to_file.title'
      | 'expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.title'
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
          options.on_value_change(
            next_value === 'enabled',
          )
        }}
      />
    )
  }

  async function handle_response_check_menu_button_click(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault()

    if (is_response_check_menu_open) {
      set_is_response_check_menu_open(false)
    } else {
      await expert_settings_state.refresh_snapshot()
      set_is_response_check_menu_open(true)
    }
  }

  return (
    <div
      className="expert-settings-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      {expert_settings_state.refresh_error !== null
        ? (
            <Alert variant="destructive" className="expert-settings-page__notice">
              <AlertCircle />
              <AlertTitle>{t('expert_settings_page.feedback.refresh_failed_title')}</AlertTitle>
              <AlertDescription>{expert_settings_state.refresh_error}</AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={expert_settings_state.is_refreshing}
                  onClick={() => {
                    void expert_settings_state.refresh_snapshot()
                  }}
                >
                  {expert_settings_state.is_refreshing
                    ? (
                        <>
                          <LoaderCircle className="animate-spin" data-icon="inline-start" />
                          {t('app.action.loading')}
                        </>
                      )
                    : t('expert_settings_page.feedback.retry')}
                </Button>
              </AlertAction>
            </Alert>
          )
        : null}

      <section className="expert-settings-page__list" aria-label={t('expert_settings_page.title')}>
        <SettingCardRow
          title={t('expert_settings_page.fields.response_check_settings.title')}
          description={t('expert_settings_page.fields.response_check_settings.description')}
          action={(
            <DropdownMenu
              open={is_response_check_menu_open}
              onOpenChange={(next_open) => {
                set_is_response_check_menu_open(next_open)
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="expert-settings-page__menu-button"
                  onClick={(event) => {
                    void handle_response_check_menu_button_click(event)
                  }}
                >
                  {t('expert_settings_page.fields.response_check_settings.button')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuGroup>
                  <DropdownMenuCheckboxItem
                    checked={expert_settings_state.snapshot.check_kana_residue}
                    disabled={expert_settings_state.pending_state.check_kana_residue}
                    onCheckedChange={(next_checked) => {
                      if (typeof next_checked === 'boolean') {
                        void expert_settings_state.update_check_kana_residue(next_checked)
                      }
                    }}
                  >
                    {t('expert_settings_page.fields.response_check_settings.options.kana_residue')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={expert_settings_state.snapshot.check_hangeul_residue}
                    disabled={expert_settings_state.pending_state.check_hangeul_residue}
                    onCheckedChange={(next_checked) => {
                      if (typeof next_checked === 'boolean') {
                        void expert_settings_state.update_check_hangeul_residue(next_checked)
                      }
                    }}
                  >
                    {t('expert_settings_page.fields.response_check_settings.options.hangeul_residue')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={expert_settings_state.snapshot.check_similarity}
                    disabled={expert_settings_state.pending_state.check_similarity}
                    onCheckedChange={(next_checked) => {
                      if (typeof next_checked === 'boolean') {
                        void expert_settings_state.update_check_similarity(next_checked)
                      }
                    }}
                  >
                    {t('expert_settings_page.fields.response_check_settings.options.similarity')}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.preceding_lines_threshold.title')}
          description={t('expert_settings_page.fields.preceding_lines_threshold.description')}
          action={(
            <div className="expert-settings-page__number-field">
              <Input
                className="expert-settings-page__number-input"
                type="number"
                min={PRECEDING_LINES_THRESHOLD_MIN}
                max={PRECEDING_LINES_THRESHOLD_MAX}
                value={expert_settings_state.snapshot.preceding_lines_threshold}
                disabled={expert_settings_state.pending_state.preceding_lines_threshold}
                onChange={(event) => {
                  void expert_settings_state.update_preceding_lines_threshold(Number(event.target.value))
                }}
              />
            </div>
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.clean_ruby.title')}
          description={t('expert_settings_page.fields.clean_ruby.description')}
          action={(
            render_boolean_toggle({
              title_key: 'expert_settings_page.fields.clean_ruby.title',
              value: expert_settings_state.snapshot.clean_ruby,
              disabled: expert_settings_state.pending_state.clean_ruby,
              on_value_change: (next_value) => {
                void expert_settings_state.update_clean_ruby(next_value)
              },
            })
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.deduplication_in_trans.title')}
          description={t('expert_settings_page.fields.deduplication_in_trans.description')}
          action={(
            render_boolean_toggle({
              title_key: 'expert_settings_page.fields.deduplication_in_trans.title',
              value: expert_settings_state.snapshot.deduplication_in_trans,
              disabled: expert_settings_state.pending_state.deduplication_in_trans,
              on_value_change: (next_value) => {
                void expert_settings_state.update_deduplication_in_trans(next_value)
              },
            })
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.deduplication_in_bilingual.title')}
          description={t('expert_settings_page.fields.deduplication_in_bilingual.description')}
          action={(
            render_boolean_toggle({
              title_key: 'expert_settings_page.fields.deduplication_in_bilingual.title',
              value: expert_settings_state.snapshot.deduplication_in_bilingual,
              disabled: expert_settings_state.pending_state.deduplication_in_bilingual,
              on_value_change: (next_value) => {
                void expert_settings_state.update_deduplication_in_bilingual(next_value)
              },
            })
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.write_translated_name_fields_to_file.title')}
          description={t('expert_settings_page.fields.write_translated_name_fields_to_file.description')}
          action={(
            render_boolean_toggle({
              title_key: 'expert_settings_page.fields.write_translated_name_fields_to_file.title',
              value: expert_settings_state.snapshot.write_translated_name_fields_to_file,
              disabled: expert_settings_state.pending_state.write_translated_name_fields_to_file,
              on_value_change: (next_value) => {
                void expert_settings_state.update_write_translated_name_fields_to_file(next_value)
              },
            })
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.title')}
          description={t('expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.description')}
          action={(
            render_boolean_toggle({
              title_key: 'expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.title',
              value: expert_settings_state.snapshot.auto_process_prefix_suffix_preserved_text,
              disabled: expert_settings_state.pending_state.auto_process_prefix_suffix_preserved_text,
              on_value_change: (next_value) => {
                void expert_settings_state.update_auto_process_prefix_suffix_preserved_text(next_value)
              },
            })
          )}
        />
      </section>
    </div>
  )
}


