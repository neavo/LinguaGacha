import { ListFilter, Regex, TriangleAlert, X } from 'lucide-react'
import * as React from 'react'

import '@/widgets/search-bar/search-bar.css'
import { cn } from '@/lib/utils'
import { Button } from '@/shadcn/button'
import { Card, CardContent } from '@/shadcn/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shadcn/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/shadcn/input-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shadcn/tooltip'

export type SearchBarScopeOption<scope_value extends string = string> = {
  value: scope_value
  label: React.ReactNode
}

type SearchBarProps<scope_value extends string = string> = React.ComponentProps<'section'> & {
  keyword: string
  placeholder: string
  clear_label: string
  invalid_message: string | null
  on_keyword_change: (next_keyword: string) => void
  scope: {
    value: scope_value
    button_label: React.ReactNode
    aria_label: string
    tooltip: React.ReactNode
    options: SearchBarScopeOption<scope_value>[]
    on_change: (next_value: scope_value) => void
  }
  regex: {
    value: boolean
    label: React.ReactNode
    tooltip: React.ReactNode
    enabled_label: React.ReactNode
    disabled_label: React.ReactNode
    on_change: (next_value: boolean) => void
  }
}

export function SearchBar<scope_value extends string = string>(
  props: SearchBarProps<scope_value>,
): JSX.Element {
  const {
    className,
    keyword,
    placeholder,
    clear_label,
    invalid_message,
    on_keyword_change,
    scope,
    regex,
    ...card_props
  } = props
  const show_clear_keyword = keyword !== ''
  const show_invalid_state = invalid_message !== null
  const show_inline_controls = show_clear_keyword || show_invalid_state
  const regex_menu_value = regex.value ? 'enabled' : 'disabled'

  return (
    <Card
      variant="toolbar"
      role="search"
      className={cn('search-bar', className)}
      {...card_props}
    >
      <CardContent className="search-bar__content">
        <div className="search-bar__toolbar">
          <InputGroup className="search-bar__input-group">
            <InputGroupInput
              value={keyword}
              aria-invalid={show_invalid_state}
              className="search-bar__input"
              placeholder={placeholder}
              onChange={(event) => {
                on_keyword_change(event.target.value)
              }}
            />
            {show_inline_controls
              ? (
                  <InputGroupAddon
                    align="inline-end"
                    className="search-bar__input-addon"
                  >
                    {show_clear_keyword
                      ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <InputGroupButton
                                size="icon-xs"
                                aria-label={clear_label}
                                className="search-bar__clear-button"
                                onClick={() => {
                                  on_keyword_change('')
                                }}
                              >
                                <X />
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8}>
                              <p>{clear_label}</p>
                            </TooltipContent>
                          </Tooltip>
                        )
                      : null}
                    {show_invalid_state
                      ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <InputGroupButton
                                size="icon-xs"
                                aria-label={invalid_message ?? undefined}
                                className="search-bar__invalid-button"
                              >
                                <TriangleAlert />
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8}>
                              <p className="search-bar__invalid-tooltip">
                                {invalid_message}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )
                      : null}
                  </InputGroupAddon>
                )
              : null}
          </InputGroup>
          <div className="search-bar__actions">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="toolbar"
                      className="search-bar__action-trigger"
                      data-active={scope.value === 'all' ? undefined : 'true'}
                      aria-label={scope.aria_label}
                    >
                      <ListFilter data-icon="inline-start" />
                      {scope.button_label}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={10}>
                  <p>{scope.tooltip}</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="center">
                <DropdownMenuRadioGroup
                  value={scope.value}
                  onValueChange={(next_value) => {
                    scope.on_change(next_value as scope_value)
                  }}
                >
                  {scope.options.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
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
                      className="search-bar__action-trigger"
                      data-active={regex.value ? 'true' : undefined}
                    >
                      <Regex data-icon="inline-start" />
                      {regex.label}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={10}>
                  <p>{regex.tooltip}</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="center">
                <DropdownMenuRadioGroup
                  value={regex_menu_value}
                  onValueChange={(next_value) => {
                    regex.on_change(next_value === 'enabled')
                  }}
                >
                  <DropdownMenuRadioItem
                    value="enabled"
                  >
                    {regex.enabled_label}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="disabled"
                  >
                    {regex.disabled_label}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

