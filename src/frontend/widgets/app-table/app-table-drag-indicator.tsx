import { GripVertical } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import type { Ref } from "react";

type AppTableDragIndicatorProps = {
  row_number: number;
  disabled: boolean;
  dragging: boolean;
  handle_ref?: Ref<HTMLButtonElement>;
  show_tooltip?: boolean;
};

/** 序号与手柄共用显示状态；浮层保留拖动手型而不注册交互。 */
export function AppTableDragIndicator(props: AppTableDragIndicatorProps): JSX.Element {
  const { t } = useI18n();
  const drag_state = props.dragging ? "dragging" : props.disabled ? "disabled" : "enabled";
  const tooltip_label = drag_state === "disabled" ? t("app.drag.disabled") : t("app.drag.enabled");
  const indicator = (
    <button
      type="button"
      ref={props.handle_ref}
      disabled={props.disabled}
      className="app-table__drag-indicator"
      data-drag-state={drag_state}
      data-app-table-ignore-box-select="true"
      data-app-table-ignore-row-click="true"
      aria-label={tooltip_label}
    >
      <span className="app-table__drag-icon" aria-hidden="true">
        <GripVertical />
      </span>
      <span className="app-table__drag-row-index">{props.row_number}</span>
    </button>
  );

  if (props.show_tooltip === false) {
    return indicator;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={indicator} />
      <TooltipContent>
        <p>{tooltip_label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
