import { Filter } from 'lucide-react'
import type { ReactNode } from 'react'

import { useI18n } from '@/i18n'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'

type GlossaryColumnFilterMenuProps = {
  label: string
  active: boolean
  disabled?: boolean
  on_clear?: () => void
  children: ReactNode
}

export function GlossaryColumnFilterMenu(
  props: GlossaryColumnFilterMenuProps,
): JSX.Element {
  const { t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={props.active ? 'secondary' : 'ghost'}
          size="icon-xs"
          disabled={props.disabled}
          data-active={props.active ? 'true' : undefined}
          className="glossary-page__column-filter-trigger"
          aria-label={t('glossary_page.column_filter.trigger').replace('{FIELD}', props.label)}
        >
          <Filter aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        matchTriggerWidth={false}
        className="glossary-page__column-filter-menu"
      >
        <div className="glossary-page__column-filter-menu-header">
          <div className="glossary-page__column-filter-menu-copy">
            <p className="glossary-page__column-filter-menu-title">
              {props.label}
            </p>
          </div>
          {props.active && props.on_clear !== undefined
            ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={props.on_clear}
                >
                  {t('glossary_page.column_filter.clear')}
                </Button>
              )
            : null}
        </div>
        <div className="glossary-page__column-filter-menu-body">
          {props.children}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
