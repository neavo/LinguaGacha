import { PageScaffold } from '@/widgets/page-scaffold/PageScaffold'

import { app_settings_page_mock } from '@/pages/system/app-settings/mock'

type AppSettingsPageProps = {
  is_sidebar_collapsed: boolean
}

export function AppSettingsPage(props: AppSettingsPageProps): JSX.Element {
  return (
    <PageScaffold
      title_key="nav.action.app_settings"
      summary_key="setting.page.app.summary"
      mock={app_settings_page_mock}
      is_sidebar_collapsed={props.is_sidebar_collapsed}
    />
  )
}
