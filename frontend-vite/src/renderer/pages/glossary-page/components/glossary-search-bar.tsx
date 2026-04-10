import { SlidersHorizontal } from 'lucide-react'

import { useI18n } from '@/i18n'
import type { GlossaryFilterScope } from '@/pages/glossary-page/types'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { InputGroup, InputGroupInput } from '@/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

type GlossarySearchBarProps = {
  keyword: string
  scope: GlossaryFilterScope
  visible_count: number
  total_count: number
  is_regex: boolean
  invalid_filter_message: string | null
  has_active_filters: boolean
  on_keyword_change: (next_keyword: string) => void
  on_scope_change: (next_scope: GlossaryFilterScope) => void
  on_regex_change: (next_is_regex: boolean) => void
  on_clear_filters: () => void
}

export function GlossarySearchBar(props: GlossarySearchBarProps): JSX.Element {
  const { t } = useI18n()
  const show_invalid_state = props.invalid_filter_message !== null
  const show_empty_state = !show_invalid_state
    && props.has_active_filters
    && props.total_count > 0
    && props.visible_count === 0
  const filter_status = show_invalid_state
    ? t('glossary_page.filter.invalid')
    : show_empty_state
      ? t('glossary_page.filter.empty')
      : null
  const result_count_label = t('glossary_page.filter.results')
    .replace('{VISIBLE}', props.visible_count.toString())
    .replace('{TOTAL}', props.total_count.toString())

  return (
    <Card variant="toolbar" className="glossary-page__search-card">
      <CardContent className="glossary-page__search-card-content">
        <div className="glossary-page__search-shell">
          <div className="glossary-page__search-bar">
            <InputGroup className="glossary-page__search-input-group">
              <InputGroupInput
                value={props.keyword}
                aria-invalid={show_invalid_state}
                className="glossary-page__search-input"
                placeholder={t('glossary_page.filter.placeholder')}
                onChange={(event) => {
                  props.on_keyword_change(event.target.value)
                }}
              />
            </InputGroup>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={props.scope}
              className="glossary-page__search-scope"
              onValueChange={(next_value) => {
                if (next_value === '') {
                  return
                }

                props.on_scope_change(next_value as GlossaryFilterScope)
              }}
            >
              <ToggleGroupItem value="all">
                {t('glossary_page.filter.scope.all')}
              </ToggleGroupItem>
              <ToggleGroupItem value="src">
                {t('glossary_page.filter.scope.source')}
              </ToggleGroupItem>
              <ToggleGroupItem value="dst">
                {t('glossary_page.filter.scope.translation')}
              </ToggleGroupItem>
              <ToggleGroupItem value="info">
                {t('glossary_page.filter.scope.description')}
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="glossary-page__search-result-count">
              {result_count_label}
            </p>
            {props.has_active_filters
              ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={props.on_clear_filters}
                  >
                    {t('glossary_page.filter.clear')}
                  </Button>
                )
              : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant={props.is_regex ? 'secondary' : 'ghost'}
                  size="sm"
                  className="glossary-page__advanced-trigger"
                >
                  <SlidersHorizontal data-icon="inline-start" />
                  {t('glossary_page.filter.advanced')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" matchTriggerWidth={false}>
                <DropdownMenuCheckboxItem
                  checked={props.is_regex}
                  onCheckedChange={(next_checked) => {
                    if (typeof next_checked === 'boolean') {
                      props.on_regex_change(next_checked)
                    }
                  }}
                >
                  {t('glossary_page.filter.regex')}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {filter_status === null
            ? null
            : (
                <p
                  className="glossary-page__search-status"
                  data-state={show_invalid_state ? 'invalid' : 'empty'}
                  title={props.invalid_filter_message ?? undefined}
                >
                  {filter_status}
                </p>
              )}
        </div>
      </CardContent>
    </Card>
  )
}
