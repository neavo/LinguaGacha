import { badgeVariants } from "@frontend/shadcn/badge-variants";
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
  const completion_percent = active ? props.completion_percent : null;
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
    <Tooltip open={tooltip_open} onOpenChange={set_tooltip_open}>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              props.variant === "capsule" && badgeVariants(),
              "batch-translation__summary",
              props.class_name,
              `batch-translation__summary--${props.variant}`,
              !active && "batch-translation__summary--idle",
            )}
            onClick={handle_open_detail}
          >
            {completion_percent !== null ? (
              <span className="batch-translation__summary-progress" aria-hidden="true">
                <span
                  className="batch-translation__summary-fill"
                  style={{ transform: `scaleX(${completion_percent / 100})` }}
                />
              </span>
            ) : null}
            {active ? (
              <span
                className={`batch-translation__summary-mark batch-translation__summary-mark--${props.display.tone}`}
                aria-hidden="true"
              />
            ) : null}
            <span className="batch-translation__summary-content">
              <span className="batch-translation__summary-label">{props.display.status_text}</span>
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
      {/* 按钮承接可见边界与提示锚点，进度语义独立提供给辅助技术。 */}
      {completion_percent !== null ? (
        <span
          className="sr-only"
          role="progressbar"
          aria-label={props.display.status_text}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completion_percent}
        />
      ) : null}
      <TooltipContent className="whitespace-pre-line">
        <p>{props.display.detail_tooltip_text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
