import type { ComponentProps, JSX } from "react";
import { SquareMousePointer, X, type LucideIcon } from "lucide-react";

import { cn } from "@frontend/shadcn/classnames";
import { AppButton } from "@frontend/widgets/app-button";
import { type PathDropOptions, usePathDrop } from "@frontend/widgets/file-drop-zone/use-path-drop";
import "@frontend/widgets/path-selection-card/path-selection-card.css";

export type PathSelectionSummary = Readonly<{ name: string; detail?: string }>;

// 剩余按钮属性与 `ref` 落在主触发按钮上，菜单触发器可以直接以本组件作为渲染目标。
type PathSelectionCardProps = Omit<
  ComponentProps<"button">,
  "children" | "title" | "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
> &
  PathDropOptions & {
    icon: LucideIcon;
    title: string; // 空状态提示
    hint?: string; // 空状态补充说明
    summary: PathSelectionSummary | null; // `null` 表示尚未选择
    clear_label: string;
    on_clear: () => void;
  };

/** 常驻的点击与拖入选择框，路径校验和选择后的业务流程由调用页面负责。 */
export function PathSelectionCard(props: PathSelectionCardProps): JSX.Element {
  const {
    ref,
    icon: Icon,
    title,
    hint,
    summary,
    clear_label,
    on_clear,
    className,
    disabled,
    on_drop_issue: _on_drop_issue,
    on_path_drop: _on_path_drop,
    on_paths_drop: _on_paths_drop,
    ...button_props
  } = props;
  const { drop_active, drop_handlers } = usePathDrop(props);
  const SummaryIcon = summary === null ? Icon : SquareMousePointer; // 选中后沿用工程页的重新选择提示。
  const name = summary?.name ?? title; // 空状态与选中状态共用同一布局。
  const detail = summary === null ? hint : summary.detail;

  return (
    <div
      className={cn("path-selection-card", className)}
      data-drop-active={drop_active ? "true" : undefined}
      data-disabled={disabled ? "true" : undefined}
      {...drop_handlers}
    >
      <button
        ref={ref}
        {...button_props}
        className="path-selection-card__trigger"
        type="button"
        disabled={disabled}
      >
        <span className="path-selection-card__icon">
          <SummaryIcon className="size-11 stroke-[1.8]" />
        </span>
        <span className="path-selection-card__title">{name}</span>
        {detail === undefined ? null : (
          <span className="path-selection-card__detail">{detail}</span>
        )}
      </button>
      {summary === null ? null : (
        <AppButton
          variant="ghost"
          size="icon-sm"
          className="path-selection-card__clear h-[30px] w-[30px] p-0"
          disabled={disabled}
          aria-label={clear_label}
          onClick={on_clear}
        >
          <X className="size-4" />
        </AppButton>
      )}
    </div>
  );
}
