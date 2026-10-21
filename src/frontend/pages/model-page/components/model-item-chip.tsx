import { useSortable } from "@dnd-kit/react/sortable";
import { SORTABLE_OPTIONS } from "@frontend/widgets/interactions/sortable";
import { ChevronDown, GripVertical, UserRoundKey } from "lucide-react";
import type { JSX, ReactNode } from "react";

import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { AppButton } from "@frontend/widgets/app-button";
import { AppDropdownMenu, AppDropdownMenuTrigger } from "@frontend/widgets/app-dropdown-menu";
import { useModelAuthSnapshot } from "@frontend/app/state/model-auth-store";
import { is_pinned_model } from "@domain/model";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipTarget } from "@frontend/shadcn/tooltip";

type ModelItemChipProps = {
  model: ModelEntrySnapshot;
  index: number;
  drag_disabled: boolean;
  menu: ReactNode;
};

/** 单个模型条目只承接拖拽与配置菜单，不表达任务用途选择。 */
export function ModelItemChip(props: ModelItemChipProps): JSX.Element {
  const { t } = useI18n();
  const auth = useModelAuthSnapshot();
  const oauth = props.model.auth_type === "oauth";
  const pinned = is_pinned_model(props.model);
  const auth_state = auth?.connected ? "connected" : "disconnected";
  const drag_label = t(props.drag_disabled ? "app.drag.disabled" : "app.drag.enabled");
  const {
    isDragSource: isDragging,
    handleRef,
    ref,
  } = useSortable({
    ...SORTABLE_OPTIONS,
    index: props.index,
    id: props.model.id,
    disabled: props.drag_disabled || pinned,
  });

  return (
    <div
      ref={ref}
      className="model-page__item-chip"
      data-dragging={isDragging ? "true" : undefined}
      data-oauth={oauth ? "true" : undefined}
      data-pinned={pinned ? "true" : undefined}
    >
      {pinned ? null : (
        <Tooltip disabled={isDragging}>
          <TooltipTrigger
            render={
              <TooltipTarget className="model-page__drag-slot">
                <AppButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={props.drag_disabled}
                  className="model-page__drag-handle"
                  aria-label={drag_label}
                  ref={handleRef}
                >
                  <GripVertical />
                </AppButton>
              </TooltipTarget>
            }
          />
          <TooltipContent>{drag_label}</TooltipContent>
        </Tooltip>
      )}

      <AppDropdownMenu>
        <AppDropdownMenuTrigger
          render={
            <AppButton type="button" variant="outline" className="model-page__name-trigger">
              {oauth ? (
                <span
                  className="model-page__oauth-icon"
                  data-auth-state={auth_state}
                  aria-hidden="true"
                >
                  <UserRoundKey className="size-3" />
                </span>
              ) : null}
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
