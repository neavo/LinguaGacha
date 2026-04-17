import type { ScreenComponentProps } from '@/app/navigation/types'
import type { LocaleKey } from '@/i18n'
import { DebugPanelPage } from '@/pages/debug-panel-page/page'

type CreateDebugPanelScreenOptions = {
  title_key: LocaleKey
}

export function create_debug_panel_screen(
  options: CreateDebugPanelScreenOptions,
): (props: ScreenComponentProps) => JSX.Element {
  return function DebugPanelScreen(props: ScreenComponentProps): JSX.Element {
    // 把路由级标题通过闭包固定下来，让所有占位页共用同一套调试面板实现。
    return (
      <DebugPanelPage
        title_key={options.title_key}
        is_sidebar_collapsed={props.is_sidebar_collapsed}
      />
    )
  }
}
