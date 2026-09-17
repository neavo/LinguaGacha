import { badgeVariants } from "@frontend/shadcn/badge";
import { useEffect, useState } from "react";

import "./batch-translation-summary.css";

import { cn } from "@frontend/shadcn/classnames";
import type { BatchTranslationSummaryDisplay } from "@frontend/features/batch-translation/batch-translation-display";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type BatchTranslationSummaryProps = {
  class_name?: string;
  variant: "capsule" | "card";
  open_tooltip_on_start: boolean;
  display: BatchTranslationSummaryDisplay;
  completion_percent: number | null;
  on_open: () => void;
};

/** 两种外观共用任务摘要，页面决定开始时是否主动提示详情入口。 */
export function BatchTranslationSummary(props: BatchTranslationSummaryProps): JSX.Element {
  const [tooltip_open, set_tooltip_open] = useState(false);
  const { speed_text } = props.display;
  const active = speed_text !== null; // 共享摘要在翻译与停止收尾期间提供速度，终态置空。
  const { open_tooltip_on_start } = props;

  useEffect(() => {
    set_tooltip_open(active && open_tooltip_on_start);
  }, [active, open_tooltip_on_start]);

  /** 打开详情时收起提示，避免遮挡侧栏。 */
  function handle_open_detail(): void {
    set_tooltip_open(false);
    props.on_open();
  }

  return (
    <span
      className={cn(
        props.variant === "capsule" && badgeVariants(),
        "batch-translation__summary",
        props.class_name,
        `batch-translation__summary--${props.variant}`,
        !active && "batch-translation__summary--idle",
      )}
    >
      {/* 进度与详情按钮同级叠放，分别保留数值和交互语义。 */}
      {active && props.completion_percent !== null ? (
        <span
          className="batch-translation__summary-progress"
          role="progressbar"
          aria-label={props.display.status_text}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={props.completion_percent}
        >
          <span
            className="batch-translation__summary-fill"
            style={{ transform: `scaleX(${props.completion_percent / 100})` }}
          />
        </span>
      ) : null}
      <Tooltip open={tooltip_open} onOpenChange={set_tooltip_open}>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="batch-translation__summary-trigger"
              onClick={handle_open_detail}
            >
              {active ? (
                <span
                  className={`batch-translation__summary-mark batch-translation__summary-mark--${props.display.tone}`}
                  aria-hidden="true"
                />
              ) : null}
              <span className="batch-translation__summary-content">
                <span className="batch-translation__summary-label">
                  {props.display.status_text}
                </span>
                {speed_text !== null ? (
                  <span className="batch-translation__summary-speed">
                    <span className="batch-translation__summary-separator"> · </span>
                    {speed_text}
                  </span>
                ) : null}
              </span>
            </button>
          }
        />
        <TooltipContent side="top" sideOffset={8} className="whitespace-pre-line">
          <p>{props.display.detail_tooltip_text}</p>
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
