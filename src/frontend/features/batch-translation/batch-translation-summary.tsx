import { useEffect, useState } from "react";

import "./batch-translation.css";

import { cn } from "@frontend/shadcn/classnames";
import type { BatchTranslationSummaryDisplay } from "@frontend/features/batch-translation/batch-translation-display";
import { Badge } from "@frontend/shadcn/badge";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type BatchTranslationSummaryProps = {
  class_name?: string;
  display: BatchTranslationSummaryDisplay;
  on_open: () => void;
};

/** 任务开始时展开详情提示，点击摘要进入共享侧栏。 */
export function BatchTranslationSummary(props: BatchTranslationSummaryProps): JSX.Element {
  const [tooltip_open, set_tooltip_open] = useState(false);

  useEffect(() => {
    set_tooltip_open(props.display.show_spinner);
  }, [props.display.show_spinner]);

  /** 打开详情时收起提示，避免遮挡侧栏。 */
  function handle_open_detail(): void {
    set_tooltip_open(false);
    props.on_open();
  }

  const summary_badge = (
    <Badge
      variant="outline"
      className={cn(
        "batch-translation__summary",
        "batch-translation__summary-badge",
        props.class_name,
        "batch-translation__summary-badge--clickable",
        `batch-translation__summary-badge--${props.display.tone}`,
      )}
    >
      {props.display.show_spinner ? <Spinner data-icon="inline-start" /> : null}
      <span>{props.display.status_text}</span>
      {props.display.trailing_text !== null ? (
        <span className="batch-translation__summary-trailing">{props.display.trailing_text}</span>
      ) : null}
    </Badge>
  );

  return (
    <Tooltip open={tooltip_open} onOpenChange={set_tooltip_open}>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="batch-translation__summary-trigger"
            onClick={handle_open_detail}
          >
            {summary_badge}
          </button>
        }
      />
      <TooltipContent side="top" sideOffset={8}>
        <p>{props.display.detail_tooltip_text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
