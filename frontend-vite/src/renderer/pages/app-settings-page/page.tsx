import { AlertCircle, Info, LoaderCircle } from 'lucide-react'

import { useI18n } from '@/i18n'
import '@/pages/app-settings-page/app-settings-page.css'
import '@/widgets/setting-card-row/setting-card-row.css'
import { useAppSettingsState } from '@/pages/app-settings-page/use-app-settings-state'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { SettingCardRow } from '@/widgets/setting-card-row/setting-card-row'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

type AppSettingsPageProps = {
  is_sidebar_collapsed: boolean
}

const EXPERT_MODE_TOGGLE_VALUE = {
  DISABLED: 'disabled',
  ENABLED: 'enabled',
} as const

export function AppSettingsPage(props: AppSettingsPageProps): JSX.Element {
  const { t } = useI18n()
  const app_settings_state = useAppSettingsState()
  const expert_mode_toggle_value = app_settings_state.snapshot.expert_mode
    ? EXPERT_MODE_TOGGLE_VALUE.ENABLED
    : EXPERT_MODE_TOGGLE_VALUE.DISABLED

  return (
    <>
      <div
        className="app-settings-page page-shell page-shell--full"
        data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
      >
        {app_settings_state.refresh_error !== null
          ? (
              <Alert variant="destructive" className="app-settings-page__notice">
                <AlertCircle />
                <AlertTitle>{t('app_settings_page.feedback.refresh_failed_title')}</AlertTitle>
                <AlertDescription>{app_settings_state.refresh_error}</AlertDescription>
                <AlertAction>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={app_settings_state.is_refreshing}
                    onClick={() => {
                      void app_settings_state.refresh_snapshot()
                    }}
                  >
                    {app_settings_state.is_refreshing
                      ? (
                          <>
                            <LoaderCircle className="animate-spin" data-icon="inline-start" />
                            {t('app.action.loading')}
                          </>
                        )
                      : t('app_settings_page.feedback.retry')}
                  </Button>
                </AlertAction>
              </Alert>
            )
          : null}

        <section className="app-settings-page__list" aria-label={t('app_settings_page.title')}>
          <SettingCardRow
            title={t('app_settings_page.fields.expert_mode.title')}
            description={t('app_settings_page.fields.expert_mode.description')}
            action={(
              <ToggleGroup
                type="single"
                variant="segmented"
                className="app-settings-page__toggle-group"
                aria-label={t('app_settings_page.fields.expert_mode.title')}
                value={expert_mode_toggle_value}
                disabled={app_settings_state.pending_state.expert_mode}
                onValueChange={(next_value) => {
                  if (next_value === EXPERT_MODE_TOGGLE_VALUE.DISABLED) {
                    void app_settings_state.update_expert_mode(false)
                  } else if (next_value === EXPERT_MODE_TOGGLE_VALUE.ENABLED) {
                    void app_settings_state.update_expert_mode(true)
                  }
                }}
              >
                <ToggleGroupItem
                  className="app-settings-page__toggle-item"
                  value={EXPERT_MODE_TOGGLE_VALUE.DISABLED}
                >
                  {t('app.toggle.disabled')}
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="app-settings-page__toggle-item"
                  value={EXPERT_MODE_TOGGLE_VALUE.ENABLED}
                >
                  {t('app.toggle.enabled')}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          />
        </section>
      </div>

      <AlertDialog
        open={app_settings_state.is_restart_confirm_open}
        onOpenChange={(next_open) => {
          if (!next_open) {
            app_settings_state.close_restart_confirm()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Info />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('app_settings_page.restart_confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('app_settings_page.restart_confirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('app_settings_page.restart_confirm.actions.cancel')}</AlertDialogCancel>
            <Button
              onClick={() => {
                void app_settings_state.confirm_restart()
              }}
            >
              {app_settings_state.is_quit_pending
                ? (
                    <>
                      <LoaderCircle className="animate-spin" data-icon="inline-start" />
                      {t('app.action.loading')}
                    </>
                  )
                : t('app_settings_page.restart_confirm.actions.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

