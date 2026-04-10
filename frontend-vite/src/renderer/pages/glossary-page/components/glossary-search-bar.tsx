import { Eraser, ListFilter, Regex } from 'lucide-react'

import { useI18n } from '@/i18n'
import type { GlossaryFilterScope } from '@/pages/glossary-page/types'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { InputGroup, InputGroupInput } from '@/ui/input-group'

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
  const scope_label = props.scope === 'src'
    ? t('glossary_page.filter.scope.source')
    : props.scope === 'dst'
      ? t('glossary_page.filter.scope.translation')
      : props.scope === 'info'
        ? t('glossary_page.filter.scope.description')
        : t('glossary_page.filter.scope.label')

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
            <div className="glossary-page__search-actions">
              <Button
                type="button"
                variant="ghost"
                size="toolbar"
                disabled={!props.has_active_filters}
                className="glossary-page__search-action-trigger"
                onClick={props.on_clear_filters}
              >
                <Eraser data-icon="inline-start" />
                {t('glossary_page.filter.clear')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="toolbar"
                    className="glossary-page__search-action-trigger"
                    data-active={props.scope === 'all' ? undefined : 'true'}
                    aria-label={t('glossary_page.filter.scope.label')}
                  >
                    <ListFilter data-icon="inline-start" />
                    {scope_label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" matchTriggerWidth={false}>
                  <DropdownMenuGroup>
                    {(['all', 'src', 'dst', 'info'] satisfies GlossaryFilterScope[]).map((scope) => (
                      <DropdownMenuCheckboxItem
                        key={scope}
                        checked={props.scope === scope}
                        onCheckedChange={(next_checked) => {
                          if (next_checked === true) {
                            props.on_scope_change(scope)
                          }
                        }}
                      >
                        {scope === 'all'
                          ? t('glossary_page.filter.scope.all')
                          : scope === 'src'
                            ? t('glossary_page.filter.scope.source')
                            : scope === 'dst'
                              ? t('glossary_page.filter.scope.translation')
                              : t('glossary_page.filter.scope.description')}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="toolbar"
                    className="glossary-page__search-action-trigger"
                    data-active={props.is_regex ? 'true' : undefined}
                  >
                    <Regex data-icon="inline-start" />
                    {t('glossary_page.filter.regex')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" matchTriggerWidth={false}>
                  <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                      checked={props.is_regex}
                      onCheckedChange={(next_checked) => {
                        if (next_checked === true) {
                          props.on_regex_change(true)
                        }
                      }}
                    >
                      {t('app.toggle.enabled')}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={!props.is_regex}
                      onCheckedChange={(next_checked) => {
                        if (next_checked === true) {
                          props.on_regex_change(false)
                        }
                      }}
                    >
                      {t('app.toggle.disabled')}
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
