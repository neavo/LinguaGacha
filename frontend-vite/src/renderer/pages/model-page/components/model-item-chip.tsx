import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, GripVertical } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { ModelEntrySnapshot } from '@/pages/model-page/types'
import { Button } from '@/shadcn/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/shadcn/dropdown-menu'

type ModelItemChipProps = {
  model: ModelEntrySnapshot
  active: boolean
  drag_disabled: boolean
  drag_aria_label: string
  menu: ReactNode
}

export function ModelItemChip(props: ModelItemChipProps): JSX.Element {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: props.model.id,
    disabled: props.drag_disabled,
  })

  const item_style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      className="model-page__item-chip"
      data-active={props.active ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      style={item_style}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={props.drag_disabled}
        className="model-page__drag-handle"
        aria-label={props.drag_aria_label}
        onClick={(event) => {
          event.stopPropagation()
        }}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={props.active ? 'default' : 'outline'}
            className={cn('model-page__name-trigger', props.active ? 'model-page__name-trigger--active' : undefined)}
          >
            <span className="model-page__name-text">{props.model.name}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        {props.menu}
      </DropdownMenu>
    </div>
  )
}

