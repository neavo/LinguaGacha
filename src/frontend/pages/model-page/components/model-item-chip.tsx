import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, GripVertical } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { AppButton } from "@frontend/widgets/app-button";
import { AppDropdownMenu, AppDropdownMenuTrigger } from "@frontend/widgets/app-dropdown-menu";

type ModelItemChipProps = {
  model: ModelEntrySnapshot;
  drag_disabled: boolean;
  drag_aria_label: string;
  menu: ReactNode;
};

/** 单个模型条目只承接拖拽与配置菜单，不表达任务用途选择。 */
export function ModelItemChip(props: ModelItemChipProps): JSX.Element {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: props.model.id,
    disabled: props.drag_disabled,
  });

  const item_style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      className="model-page__item-chip"
      data-dragging={isDragging ? "true" : undefined}
      style={item_style}
    >
      <AppButton
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={props.drag_disabled}
        className="model-page__drag-handle"
        aria-label={props.drag_aria_label}
        onClick={(event) => {
          event.stopPropagation();
        }}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </AppButton>

      <AppDropdownMenu>
        <AppDropdownMenuTrigger
          render={
            <AppButton type="button" variant="outline" className="model-page__name-trigger">
              <span className="model-page__name-text">{props.model.name}</span>
              <ChevronDown data-icon="inline-end" />
            </AppButton>
          }
        />
        {props.menu}
      </AppDropdownMenu>
    </div>
  );
}
