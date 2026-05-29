import { useEffect, useState } from "react";

import "./workbench-task.css";

import { cn } from "@frontend/styling/classnames";
import type {
  WorkbenchTaskSummaryViewModel,
  WorkbenchTaskTone,
} from "@frontend/pages/workbench-page/types";
import { Badge } from "@frontend/shadcn/badge";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type WorkbenchTaskSummaryProps = {
  class_name?: string;
  view_model: WorkbenchTaskSummaryViewModel;
  can_open: boolean;
  auto_open_key?: string | null;
  on_open: () => void;
};

function resolve_summary_badge_tone_class_name(tone: WorkbenchTaskTone): string {
  if (tone === "warning") {
    return "workbench-task__summary-badge--warning";
  }

  if (tone === "success") {
    return "workbench-task__summary-badge--success";
  }

  return "workbench-task__summary-badge--neutral";
}

export function WorkbenchTaskSummary(props: WorkbenchTaskSummaryProps): JSX.Element {
  const [tooltip_open, set_tooltip_open] = useState(false);

  useEffect(() => {
    if (!props.can_open || props.auto_open_key == null) {
      set_tooltip_open(false);
      return;
    }

    set_tooltip_open(true);
  }, [props.auto_open_key, props.can_open]);

  function handle_open_change(open: boolean): void {
    set_tooltip_open(open);
  }

  function handle_open_detail(): void {
    set_tooltip_open(false);
    props.on_open();
  }

  const summary_badge = (
    <Badge
      variant="outline"
      className={cn(
        "workbench-task__summary",
        "workbench-task__summary-badge",
        props.class_name,
        props.can_open ? "workbench-task__summary-badge--clickable" : null,
        resolve_summary_badge_tone_class_name(props.view_model.tone),
      )}
    >
      {props.view_model.show_spinner ? <Spinner data-icon="inline-start" /> : null}
      <span>{props.view_model.status_text}</span>
      {props.view_model.trailing_text !== null ? (
        <span className="workbench-task__summary-trailing">{props.view_model.trailing_text}</span>
      ) : null}
    </Badge>
  );

  if (!props.can_open) {
    return summary_badge;
  }

  return (
    <Tooltip open={tooltip_open} onOpenChange={handle_open_change}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="workbench-task__summary-trigger"
          onClick={handle_open_detail}
        >
          {summary_badge}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p>{props.view_model.detail_tooltip_text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
