import { Funnel, Search } from 'lucide-react'

import { useI18n } from '@/i18n'
import { Button } from '@/shadcn/button'
import { Card, CardContent } from '@/shadcn/card'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/shadcn/input-group'

type ProofreadingToolbarProps = {
  search_keyword: string
  replace_text: string
  is_regex: boolean
  invalid_regex_message: string | null
  disabled: boolean
  on_search_keyword_change: (next_keyword: string) => void
  on_replace_text_change: (next_replace_text: string) => void
  on_regex_change: (next_is_regex: boolean) => void
  on_replace_next: () => Promise<void>
  on_replace_all: () => Promise<void>
  on_open_filter: () => void
}

export function ProofreadingToolbar(props: ProofreadingToolbarProps): JSX.Element {
  const { t } = useI18n()

  return (
    <Card variant="toolbar" className="proofreading-page__toolbar-card">
      <CardContent className="proofreading-page__toolbar-card-content">
        <div className="proofreading-page__toolbar-main">
          <InputGroup className="proofreading-page__toolbar-field proofreading-page__toolbar-field--search">
            <InputGroupAddon align="inline-start">
              <InputGroupText>
                <Search />
                {t('proofreading_page.search.label')}
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={props.search_keyword}
              disabled={props.disabled}
              placeholder={t('proofreading_page.search.placeholder')}
              onChange={(event) => {
                props.on_search_keyword_change(event.target.value)
              }}
            />
          </InputGroup>

          <InputGroup className="proofreading-page__toolbar-field proofreading-page__toolbar-field--replace">
            <InputGroupAddon align="inline-start">
              <InputGroupText>{t('proofreading_page.search.replace_label')}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={props.replace_text}
              disabled={props.disabled}
              placeholder={t('proofreading_page.search.replace_placeholder')}
              onChange={(event) => {
                props.on_replace_text_change(event.target.value)
              }}
            />
          </InputGroup>

          <div className="proofreading-page__toolbar-actions">
            <Button
              type="button"
              size="toolbar"
              variant={props.is_regex ? 'secondary' : 'outline'}
              disabled={props.disabled}
              aria-pressed={props.is_regex}
              onClick={() => {
                props.on_regex_change(!props.is_regex)
              }}
            >
              {t('proofreading_page.search.regex')}
            </Button>
            <Button
              type="button"
              size="toolbar"
              disabled={props.disabled}
              onClick={() => {
                void props.on_replace_next()
              }}
            >
              {t('proofreading_page.action.replace')}
            </Button>
            <Button
              type="button"
              size="toolbar"
              variant="outline"
              disabled={props.disabled}
              onClick={() => {
                void props.on_replace_all()
              }}
            >
              {t('proofreading_page.action.replace_all')}
            </Button>
            <Button
              type="button"
              size="toolbar"
              variant="outline"
              disabled={props.disabled}
              onClick={props.on_open_filter}
            >
              <Funnel data-icon="inline-start" />
              {t('proofreading_page.action.filter')}
            </Button>
          </div>
        </div>

        {props.invalid_regex_message === null
          ? null
          : (
              <p className="proofreading-page__toolbar-error">
                {props.invalid_regex_message}
              </p>
            )}
      </CardContent>
    </Card>
  )
}
