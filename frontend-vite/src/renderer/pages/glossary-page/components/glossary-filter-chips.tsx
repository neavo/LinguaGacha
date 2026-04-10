import { X } from 'lucide-react'

import { useI18n } from '@/i18n'
import type { GlossaryFilterChip } from '@/pages/glossary-page/types'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'

type GlossaryFilterChipsProps = {
  chips: GlossaryFilterChip[]
  on_remove_chip: (chip_id: GlossaryFilterChip['id']) => void
  on_clear_all: () => void
}

export function GlossaryFilterChips(props: GlossaryFilterChipsProps): JSX.Element | null {
  const { t } = useI18n()

  if (props.chips.length === 0) {
    return null
  }

  return (
    <div className="glossary-page__filter-chip-row">
      <div className="glossary-page__filter-chip-list">
        {props.chips.map((chip) => (
          <Badge key={chip.id} variant="secondary" asChild>
            <button
              type="button"
              className="glossary-page__filter-chip"
              aria-label={`${t('glossary_page.filter.clear')}: ${chip.label}`}
              onClick={() => {
                props.on_remove_chip(chip.id)
              }}
            >
              <span className="glossary-page__filter-chip-label">{chip.label}</span>
              <X aria-hidden="true" />
            </button>
          </Badge>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="glossary-page__filter-clear-all"
        onClick={props.on_clear_all}
      >
        {t('glossary_page.filter.clear_all')}
      </Button>
    </div>
  )
}
