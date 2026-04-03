import type { LocaleKey } from '@/i18n'
import { create_page_scaffold_mock } from '@/shared/mocks/pageScaffold'
import type { ScreenComponentProps } from '@/shared/types/screens'
import { PageScaffold } from '@/widgets/page-scaffold/PageScaffold'

type CreatePlaceholderScreenOptions = {
  title_key: LocaleKey
  summary_key: LocaleKey
  card_count?: number
  accent_card_indices?: number[]
}

export function create_placeholder_screen(
  options: CreatePlaceholderScreenOptions,
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
