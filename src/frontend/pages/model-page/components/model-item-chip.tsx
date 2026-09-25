import { useSortable } from "@dnd-kit/react/sortable";
import { SORTABLE_OPTIONS } from "@frontend/widgets/interactions/sortable";
import { ChevronDown, GripVertical } from "lucide-react";
import type { JSX, ReactNode } from "react";

import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { AppButton } from "@frontend/widgets/app-button";
import { AppDropdownMenu, AppDropdownMenuTrigger } from "@frontend/widgets/app-dropdown-menu";

type ModelItemChipProps = {
  model: ModelEntrySnapshot;
  index: number;
  drag_disabled: boolean;
  drag_aria_label: string;
  menu: ReactNode;
};

/** 单个模型条目只承接拖拽与配置菜单，不表达任务用途选择。 */
export function ModelItemChip(props: ModelItemChipProps): JSX.Element {
  const {
    isDragSource: isDragging,
    handleRef,
    ref,
  } = useSortable({
    ...SORTABLE_OPTIONS,
    index: props.index,
    id: props.model.id,
    disabled: props.drag_disabled,
  });

  return (
    <div
      ref={ref}
      className="model-page__item-chip"
      data-dragging={isDragging ? "true" : undefined}
    >
      <AppButton
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={props.drag_disabled}
        className="model-page__drag-handle"
        aria-label={props.drag_aria_label}
        ref={handleRef}
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
