import { ArrowDown, ArrowUp, Search } from 'lucide-react'

import { useI18n } from '@/i18n'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import { Input } from '@/ui/input'

type GlossarySearchBarProps = {
  keyword: string
  match_count: number
  on_keyword_change: (next_keyword: string) => void
  on_previous_match: () => void
  on_next_match: () => void
}

export function GlossarySearchBar(props: GlossarySearchBarProps): JSX.Element {
  const { t } = useI18n()
  const has_matches = props.match_count > 0
  const show_empty_state = props.keyword.trim() !== '' && !has_matches

  return (
    <Card variant="toolbar" className="glossary-page__search-card">
      <CardContent className="glossary-page__search-card-content">
        <div className="glossary-page__search-bar">
          <Search className="glossary-page__search-icon" />
          <Input
            value={props.keyword}
            className="glossary-page__search-input"
            placeholder={t('glossary_page.search.placeholder')}
            onChange={(event) => {
              props.on_keyword_change(event.target.value)
            }}
          />
          {show_empty_state
            ? <span className="glossary-page__search-status">{t('glossary_page.search.empty')}</span>
            : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!has_matches}
            onClick={props.on_previous_match}
          >
            <ArrowUp data-icon="inline-start" />
            {t('glossary_page.search.previous')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!has_matches}
            onClick={props.on_next_match}
          >
            <ArrowDown data-icon="inline-start" />
            {t('glossary_page.search.next')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
