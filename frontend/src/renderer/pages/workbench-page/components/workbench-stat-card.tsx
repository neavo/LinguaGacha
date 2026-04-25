import { ArrowLeftRight } from "lucide-react";
import { useState, type FocusEvent, type MouseEvent } from "react";

import { Card, CardContent, CardTitle } from "@/shadcn/card";
import { cn } from "@/lib/utils";
import { tooltipContentClassName } from "@/shadcn/tooltip";

type WorkbenchStatCardProps = {
  title: string;
  value: number;
  unit: string;
  accent?: "skipped" | "success" | "warning" | "failure";
  toggle_tooltip?: string;
  on_toggle?: () => void;
};

export function WorkbenchStatCard(props: WorkbenchStatCardProps): JSX.Element {
  const is_toggleable = props.on_toggle !== undefined;
  const [tooltip_state, set_tooltip_state] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
  });

  function show_tooltip_at_pointer(event: MouseEvent<HTMLDivElement>): void {
    set_tooltip_state({
      visible: true,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function show_tooltip_at_focus(event: FocusEvent<HTMLDivElement>): void {
    const trigger_rect = event.currentTarget.getBoundingClientRect();
    set_tooltip_state({
      visible: true,
      x: trigger_rect.left + trigger_rect.width / 2,
      y: trigger_rect.top + 12,
    });
  }

  function hide_tooltip(): void {
    set_tooltip_state((previous_state) => {
      return {
        ...previous_state,
        visible: false,
      };
    });
  }

  const card = (
    <Card className="workbench-page__stat-card">
      <CardContent className="workbench-page__stat-card-content">
        <div className="workbench-page__stat-card-stack">
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--title">
            <CardTitle className="workbench-page__stat-card-title">{props.title}</CardTitle>
          </div>
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--value">
            <div className="workbench-page__stat-card-metric">
              <p
                className={cn(
                  "workbench-page__stat-card-value",
                  props.accent === "skipped" && "workbench-page__stat-card-value--skipped",
                  props.accent === "success" && "workbench-page__stat-card-value--success",
                  props.accent === "warning" && "workbench-page__stat-card-value--warning",
                  props.accent === "failure" && "workbench-page__stat-card-value--failure",
                )}
              >
                {props.value.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--unit">
            <div className="workbench-page__stat-card-unit-row">
              <span className="workbench-page__stat-card-unit">{props.unit}</span>
              {is_toggleable ? (
                <ArrowLeftRight
                  className="workbench-page__stat-card-toggle-icon"
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!is_toggleable || props.toggle_tooltip === undefined) {
    return card;
  }

  return (
    <>
      <div
        className="workbench-page__stat-card-trigger"
        role="button"
        tabIndex={0}
        aria-describedby={tooltip_state.visible ? "workbench-stat-card-tooltip" : undefined}
        onClick={props.on_toggle}
        onMouseEnter={show_tooltip_at_pointer}
        onMouseMove={show_tooltip_at_pointer}
        onMouseLeave={hide_tooltip}
        onFocus={show_tooltip_at_focus}
        onBlur={hide_tooltip}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.on_toggle?.();
          }
        }}
      >
        {card}
      </div>
      {tooltip_state.visible ? (
        <div
          id="workbench-stat-card-tooltip"
          data-slot="tooltip-content"
          className={cn(tooltipContentClassName, "workbench-page__cursor-tooltip")}
          role="tooltip"
          style={{
            left: tooltip_state.x,
            top: tooltip_state.y,
          }}
        >
          {props.toggle_tooltip}
        </div>
      ) : null}
    </>
  );
}
