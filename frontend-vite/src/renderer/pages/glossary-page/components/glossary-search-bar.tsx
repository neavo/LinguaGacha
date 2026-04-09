import { ArrowDown, ArrowUp, Search } from 'lucide-react'

import { useI18n } from '@/i18n'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/ui/input-group'
import { Toggle } from '@/ui/toggle'

type GlossarySearchBarProps = {
  keyword: string
  is_regex: boolean
  match_count: number
  invalid_regex_message: string | null
  on_keyword_change: (next_keyword: string) => void
  on_regex_change: (next_is_regex: boolean) => void
  on_search: () => void
  on_previous_match: () => void
  on_next_match: () => void
}

export function GlossarySearchBar(props: GlossarySearchBarProps): JSX.Element {
  const { t } = useI18n()
  const has_matches = props.match_count > 0
  const show_invalid_state = props.invalid_regex_message !== null
  const show_empty_state = !show_invalid_state && props.keyword.trim() !== '' && !has_matches
  const search_status = show_invalid_state
    ? t('glossary_page.search.invalid')
    : show_empty_state
      ? t('glossary_page.search.empty')
      : null

  return (
    <Card variant="toolbar" className="glossary-page__search-card">
      <CardContent className="glossary-page__search-card-content">
        <div className="glossary-page__search-shell">
          <div className="glossary-page__search-bar">
            <Toggle
              pressed={props.is_regex}
              variant="outline"
              size="sm"
              className="glossary-page__search-toggle"
              aria-label={t('glossary_page.search.regex')}
              onPressedChange={props.on_regex_change}
            >
              {t('glossary_page.search.regex')}
            </Toggle>
            <InputGroup className="glossary-page__search-input-group">
              <InputGroupInput
                value={props.keyword}
                aria-invalid={show_invalid_state}
                className="glossary-page__search-input"
                placeholder={t('glossary_page.search.placeholder')}
                onChange={(event) => {
                  props.on_keyword_change(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    props.on_search()
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('glossary_page.search.execute')}
                  className="glossary-page__search-submit"
                  onClick={props.on_search}
                >
                  <Search />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <div className="glossary-page__search-nav">
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
          </div>
          {search_status === null
            ? null
            : (
                <p
                  className="glossary-page__search-status"
                  data-state={show_invalid_state ? 'invalid' : 'empty'}
                  title={props.invalid_regex_message ?? undefined}
                >
                  {search_status}
                </p>
              )}
        </div>
      </CardContent>
    </Card>
  )
}
