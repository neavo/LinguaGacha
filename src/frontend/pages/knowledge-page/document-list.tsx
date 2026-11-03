import type { JSX, ReactNode, Ref } from "react";
import { BadgeHelp, GripVertical } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Badge } from "@frontend/shadcn/badge";
import { Card } from "@frontend/shadcn/card";
import { Tooltip, TooltipContent, TooltipTarget, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import "./document-list.css";

export type DocumentListGroupHelp = { label: string; on_click: () => void };

/** 一组同类条目，标题旁的帮助按钮以可见提示作为无障碍名称。空态文案由调用方在读取完成后传入。 */
export function DocumentListGroup(props: {
  title: string;
  help?: DocumentListGroupHelp;
  busy?: boolean;
  empty?: string | undefined;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section className="document-list" aria-label={props.title} aria-busy={props.busy}>
      <div className="document-list__header">
        <h2>{props.title}</h2>
        {props.help && (
          <Tooltip>
            <TooltipTrigger
              render={
                <AppButton
                  variant="ghost"
                  size="icon-xs"
                  aria-label={props.help.label}
                  onClick={props.help.on_click}
                >
                  <BadgeHelp aria-hidden="true" />
                </AppButton>
              }
            />
            <TooltipContent>{props.help.label}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {props.children}
      {props.empty !== undefined && (
        <Card render={<p />} className="document-list__empty">
          {props.empty}
        </Card>
      )}
    </section>
  );
}

export type DocumentListRowProps = {
  name: string;
  description?: string | undefined;
  readonly_label?: string | undefined;
  open_disabled: boolean;
  on_open: () => void;
  action?: ReactNode;
  sort?: {
    row_ref: Ref<HTMLLIElement>;
    handle_ref: Ref<HTMLButtonElement>;
    dragging: boolean;
    disabled: boolean;
  };
};

/** 整行打开按钮与独立操作区共存。不可排序的条目保留禁用把手，使各分组列宽对齐。 */
export function DocumentListRow(props: DocumentListRowProps): JSX.Element {
  const { t } = useI18n();
  const dragging = props.sort?.dragging ?? false;
  const sort_disabled = props.sort?.disabled ?? true;
  const drag_label = t(sort_disabled ? "app.drag.disabled" : "app.drag.enabled");
  return (
    <li
      ref={props.sort?.row_ref}
      className="document-list__row"
      data-dragging={dragging || undefined}
    >
      <button
        type="button"
        className="document-list__open"
        aria-label={props.name}
        disabled={props.open_disabled || dragging}
        onClick={props.on_open}
      />
      <Tooltip disabled={dragging}>
        <TooltipTrigger render={<TooltipTarget className="document-list__handle-slot" />}>
          <AppButton
            ref={props.sort?.handle_ref}
            variant="ghost"
            size="icon-sm"
            className="document-list__handle"
            disabled={sort_disabled}
            aria-label={drag_label}
          >
            <GripVertical />
          </AppButton>
        </TooltipTrigger>
        <TooltipContent>{drag_label}</TooltipContent>
      </Tooltip>
      <h3 className="document-list__heading">
        <span>{props.name}</span>
        {props.readonly_label && <Badge tone="neutral">{props.readonly_label}</Badge>}
      </h3>
      {props.action && <div className="document-list__actions">{props.action}</div>}
      {props.description && <p className="document-list__description">{props.description}</p>}
    </li>
  );
}
