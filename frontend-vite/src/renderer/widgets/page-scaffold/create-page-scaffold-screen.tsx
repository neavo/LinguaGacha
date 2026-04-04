import type { LocaleKey } from '@/i18n'
import type { ScreenComponentProps } from '@/app/navigation/types'
import { create_page_scaffold_mock } from '@/widgets/page-scaffold/page-scaffold.mock'
import { PageScaffold } from '@/widgets/page-scaffold/page-scaffold'

type CreatePageScaffoldScreenOptions = {
  title_key: LocaleKey
  summary_key: LocaleKey
  card_count?: number
  accent_card_indices?: number[]
}

export function create_page_scaffold_screen(
  options: CreatePageScaffoldScreenOptions,
): (props: ScreenComponentProps) => JSX.Element {
  const placeholder_mock = create_page_scaffold_mock({
    card_count: options.card_count ?? 4,
    accent_card_indices: options.accent_card_indices,
  })

  return function PlaceholderScreen(props: ScreenComponentProps): JSX.Element {
    return (
      <PageScaffold
        title_key={options.title_key}
        summary_key={options.summary_key}
        mock={placeholder_mock}
        is_sidebar_collapsed={props.is_sidebar_collapsed}
      />
    )
  }
}
