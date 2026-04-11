import { ListFilter, Regex, X } from 'lucide-react'

import { useI18n } from '@/i18n'
import type { TextReplacementFilterScope } from '@/pages/text-replacement-page/types'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/ui/input-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip'

type TextReplacementSearchCardProps = {
  keyword: string
  scope: TextReplacementFilterScope
  is_regex: boolean
  invalid_filter_message: string | null
  on_keyword_change: (next_keyword: string) => void
  on_scope_change: (next_scope: TextReplacementFilterScope) => void
  on_regex_change: (next_is_regex: boolean) => void
}

export function TextReplacementSearchCard(
  props: TextReplacementSearchCardProps,
): JSX.Element {
  const { t } = useI18n()
  const show_invalid_state = props.invalid_filter_message !== null
  const show_clear_keyword = props.keyword !== ''
  const regex_state_label = props.is_regex
    ? t('app.toggle.enabled')
    : t('app.toggle.disabled')
  const filter_status = show_invalid_state
    ? t('text_replacement_page.filter.invalid')
    : null
  const scope_button_label = props.scope === 'src'
    ? t('text_replacement_page.filter.scope.source')
    : props.scope === 'dst'
      ? t('text_replacement_page.filter.scope.replacement')
      : t('text_replacement_page.filter.scope.label')
  const scope_state_label = props.scope === 'all'
    ? t('text_replacement_page.filter.scope.all')
    : props.scope === 'src'
      ? t('text_replacement_page.filter.scope.source')
      : t('text_replacement_page.filter.scope.replacement')
  const scope_tooltip = t('text_replacement_page.toggle.status')
    .replace('{TITLE}', t('text_replacement_page.filter.scope.tooltip_label'))
    .replace('{STATE}', scope_state_label)
  const regex_tooltip = t('text_replacement_page.toggle.status')
    .replace('{TITLE}', t('text_replacement_page.filter.regex_tooltip_label'))
    .replace('{STATE}', regex_state_label)

  return (
    <Card variant="toolbar" className="text-replacement-page__search-card">
      <CardContent className="text-replacement-page__search-card-content">
        <div className="text-replacement-page__search-shell">
          <div className="text-replacement-page__search-bar">
            <InputGroup className="text-replacement-page__search-input-group">
              <InputGroupInput
                value={props.keyword}
                aria-invalid={show_invalid_state}
                className="text-replacement-page__search-input"
                placeholder={t('text_replacement_page.filter.placeholder')}
                onChange={(event) => {
                  props.on_keyword_change(event.target.value)
                }}
              />
              {show_clear_keyword
                ? (
                    <InputGroupAddon
                      align="inline-end"
                      className="text-replacement-page__search-input-addon"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <InputGroupButton
                            size="icon-xs"
                            aria-label={t('text_replacement_page.filter.clear')}
                            className="text-replacement-page__search-clear-button"
                            onClick={() => {
                              props.on_keyword_change('')
                            }}
                          >
                            <X />
                          </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={8}>
                          <p>{t('text_replacement_page.filter.clear')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </InputGroupAddon>
                  )
                : null}
            </InputGroup>
            <div className="text-replacement-page__search-actions">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="toolbar"
                        className="text-replacement-page__search-action-trigger"
                        data-active={props.scope === 'all' ? undefined : 'true'}
                        aria-label={t('text_replacement_page.filter.scope.label')}
                      >
                        <ListFilter data-icon="inline-start" />
                        {scope_button_label}
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>
                    <p>{scope_tooltip}</p>
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="center" matchTriggerWidth={false}>
                  <DropdownMenuGroup>
                    {(['all', 'src', 'dst'] satisfies TextReplacementFilterScope[]).map((scope) => (
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
                          ? t('text_replacement_page.filter.scope.all')
                          : scope === 'src'
                            ? t('text_replacement_page.filter.scope.source')
                            : t('text_replacement_page.filter.scope.replacement')}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="toolbar"
                        className="text-replacement-page__search-action-trigger"
                        data-active={props.is_regex ? 'true' : undefined}
                      >
                        <Regex data-icon="inline-start" />
                        {t('text_replacement_page.filter.regex')}
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>
                    <p>{regex_tooltip}</p>
                  </TooltipContent>
                </Tooltip>
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p
                      className="text-replacement-page__search-status"
                      data-state="invalid"
                    >
                      {filter_status}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>
                    <p className="max-w-80 whitespace-pre-line break-words">
                      {props.invalid_filter_message}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
        </div>
      </CardContent>
    </Card>
  )
}
