import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import type { ReactNode } from 'react'

import type { ModelEntrySnapshot } from '@/pages/model-page/types'
import { Card, CardContent } from '@/shadcn/card'

type ModelCategoryCardProps = {
  title: string
  description: string
  accent_color: string
  models: ModelEntrySnapshot[]
  add_action: ReactNode
  drag_disabled: boolean
  children: ReactNode
  on_reorder: (ordered_model_ids: string[]) => void
}

export function ModelCategoryCard(props: ModelCategoryCardProps): JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function handle_drag_end(event: DragEndEvent): void {
    const { active, over } = event
    if (over === null || active.id === over.id) {
      return
    }

    const previous_index = props.models.findIndex((model) => model.id === active.id)
    const next_index = props.models.findIndex((model) => model.id === over.id)
    if (previous_index < 0 || next_index < 0) {
      return
    }

    const reordered_models = arrayMove(props.models, previous_index, next_index)
    props.on_reorder(reordered_models.map((model) => model.id))
  }

  return (
    <Card className="model-page__category-card">
      <CardContent className="model-page__category-card-content">
        <header className="model-page__category-header">
          <div className="model-page__category-main">
            <div
              className="model-page__category-accent"
              style={{ backgroundColor: props.accent_color }}
              aria-hidden="true"
            />
            <div className="model-page__category-copy">
              <h2 className="model-page__category-title font-medium">
                {props.title}
              </h2>
              <p className="model-page__category-description">{props.description}</p>
            </div>
          </div>
          <div className="model-page__category-action">
            {props.add_action}
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handle_drag_end}
        >
          <SortableContext
            items={props.models.map((model) => model.id)}
            strategy={rectSortingStrategy}
          >
            <div className="model-page__flow-list" data-readonly={props.drag_disabled ? 'true' : undefined}>
              {props.children}
            </div>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  )
}

