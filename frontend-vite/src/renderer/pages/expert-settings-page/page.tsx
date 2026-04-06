import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useState, type MouseEvent } from 'react'

import { useI18n } from '@/i18n'
import '@/pages/expert-settings-page/expert-settings-page.css'
import '@/widgets/setting-card-row/setting-card-row.css'
import { useExpertSettingsState } from '@/pages/expert-settings-page/use-expert-settings-state'
import { PRECEDING_LINES_THRESHOLD_MAX, PRECEDING_LINES_THRESHOLD_MIN } from '@/pages/expert-settings-page/types'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Input } from '@/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { SettingCardRow } from '@/widgets/setting-card-row/setting-card-row'

type ExpertSettingsPageProps = {
  is_sidebar_collapsed: boolean
}

const BOOLEAN_TOGGLE_VALUE = {
  DISABLED: 'disabled',
  ENABLED: 'enabled',
} as const

function resolve_boolean_toggle_value(current_value: boolean): string {
  if (current_value) {
    return BOOLEAN_TOGGLE_VALUE.ENABLED
  } else {
    return BOOLEAN_TOGGLE_VALUE.DISABLED
  }
}

export function ExpertSettingsPage(props: ExpertSettingsPageProps): JSX.Element {
  const { t } = useI18n()
  const expert_settings_state = useExpertSettingsState()
  const [is_response_check_menu_open, set_is_response_check_menu_open] = useState<boolean>(false)

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
              <DropdownMenuContent align="end" matchTriggerWidth={false}>
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
            <ToggleGroup
              type="single"
              variant="segmented"
              className="expert-settings-page__toggle-group"
              aria-label={t('expert_settings_page.fields.clean_ruby.title')}
              value={resolve_boolean_toggle_value(expert_settings_state.snapshot.clean_ruby)}
              disabled={expert_settings_state.pending_state.clean_ruby}
              onValueChange={(next_value) => {
                if (next_value === BOOLEAN_TOGGLE_VALUE.DISABLED) {
                  void expert_settings_state.update_clean_ruby(false)
                } else if (next_value === BOOLEAN_TOGGLE_VALUE.ENABLED) {
                  void expert_settings_state.update_clean_ruby(true)
                }
              }}
            >
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.DISABLED}
              >
                {t('app.toggle.disabled')}
              </ToggleGroupItem>
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.ENABLED}
              >
                {t('app.toggle.enabled')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.deduplication_in_trans.title')}
          description={t('expert_settings_page.fields.deduplication_in_trans.description')}
          action={(
            <ToggleGroup
              type="single"
              variant="segmented"
              className="expert-settings-page__toggle-group"
              aria-label={t('expert_settings_page.fields.deduplication_in_trans.title')}
              value={resolve_boolean_toggle_value(expert_settings_state.snapshot.deduplication_in_trans)}
              disabled={expert_settings_state.pending_state.deduplication_in_trans}
              onValueChange={(next_value) => {
                if (next_value === BOOLEAN_TOGGLE_VALUE.DISABLED) {
                  void expert_settings_state.update_deduplication_in_trans(false)
                } else if (next_value === BOOLEAN_TOGGLE_VALUE.ENABLED) {
                  void expert_settings_state.update_deduplication_in_trans(true)
                }
              }}
            >
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.DISABLED}
              >
                {t('app.toggle.disabled')}
              </ToggleGroupItem>
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.ENABLED}
              >
                {t('app.toggle.enabled')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.deduplication_in_bilingual.title')}
          description={t('expert_settings_page.fields.deduplication_in_bilingual.description')}
          action={(
            <ToggleGroup
              type="single"
              variant="segmented"
              className="expert-settings-page__toggle-group"
              aria-label={t('expert_settings_page.fields.deduplication_in_bilingual.title')}
              value={resolve_boolean_toggle_value(expert_settings_state.snapshot.deduplication_in_bilingual)}
              disabled={expert_settings_state.pending_state.deduplication_in_bilingual}
              onValueChange={(next_value) => {
                if (next_value === BOOLEAN_TOGGLE_VALUE.DISABLED) {
                  void expert_settings_state.update_deduplication_in_bilingual(false)
                } else if (next_value === BOOLEAN_TOGGLE_VALUE.ENABLED) {
                  void expert_settings_state.update_deduplication_in_bilingual(true)
                }
              }}
            >
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.DISABLED}
              >
                {t('app.toggle.disabled')}
              </ToggleGroupItem>
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.ENABLED}
              >
                {t('app.toggle.enabled')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.write_translated_name_fields_to_file.title')}
          description={t('expert_settings_page.fields.write_translated_name_fields_to_file.description')}
          action={(
            <ToggleGroup
              type="single"
              variant="segmented"
              className="expert-settings-page__toggle-group"
              aria-label={t('expert_settings_page.fields.write_translated_name_fields_to_file.title')}
              value={resolve_boolean_toggle_value(expert_settings_state.snapshot.write_translated_name_fields_to_file)}
              disabled={expert_settings_state.pending_state.write_translated_name_fields_to_file}
              onValueChange={(next_value) => {
                if (next_value === BOOLEAN_TOGGLE_VALUE.DISABLED) {
                  void expert_settings_state.update_write_translated_name_fields_to_file(false)
                } else if (next_value === BOOLEAN_TOGGLE_VALUE.ENABLED) {
                  void expert_settings_state.update_write_translated_name_fields_to_file(true)
                }
              }}
            >
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.DISABLED}
              >
                {t('app.toggle.disabled')}
              </ToggleGroupItem>
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.ENABLED}
              >
                {t('app.toggle.enabled')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />

        <SettingCardRow
          title={t('expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.title')}
          description={t('expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.description')}
          action={(
            <ToggleGroup
              type="single"
              variant="segmented"
              className="expert-settings-page__toggle-group"
              aria-label={t('expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.title')}
              value={resolve_boolean_toggle_value(expert_settings_state.snapshot.auto_process_prefix_suffix_preserved_text)}
              disabled={expert_settings_state.pending_state.auto_process_prefix_suffix_preserved_text}
              onValueChange={(next_value) => {
                if (next_value === BOOLEAN_TOGGLE_VALUE.DISABLED) {
                  void expert_settings_state.update_auto_process_prefix_suffix_preserved_text(false)
                } else if (next_value === BOOLEAN_TOGGLE_VALUE.ENABLED) {
                  void expert_settings_state.update_auto_process_prefix_suffix_preserved_text(true)
                }
              }}
            >
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.DISABLED}
              >
                {t('app.toggle.disabled')}
              </ToggleGroupItem>
              <ToggleGroupItem
                className="expert-settings-page__toggle-item"
                value={BOOLEAN_TOGGLE_VALUE.ENABLED}
              >
                {t('app.toggle.enabled')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />
      </section>
    </div>
  )
}

