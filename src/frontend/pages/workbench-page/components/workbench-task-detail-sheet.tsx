import { CircleStop } from "lucide-react";

import "./workbench-task.css";
import { cn } from "@frontend/styling/classnames";
import type {
  WorkbenchTaskDetailDisplay,
  WorkbenchTaskTone,
} from "@frontend/pages/workbench-page/types";
import { WorkbenchTaskWaveform } from "@frontend/pages/workbench-page/components/workbench-task-waveform";
import { AppButton } from "@frontend/widgets/app-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@frontend/shadcn/sheet";

type WorkbenchTaskDetailSheetProps = {
  open: boolean;
  display: WorkbenchTaskDetailDisplay;
  on_close: () => void;
  on_request_stop_confirmation: () => void;
};

/**
 * 解析当前场景的最终消费值。
 */
function resolve_percent_pill_tone_class_name(tone: WorkbenchTaskTone): string {
  if (tone === "warning") {
    return "workbench-task__percent-pill--warning";
  }

  if (tone === "success") {
    return "workbench-task__percent-pill--success";
  }

  return "workbench-task__percent-pill--neutral";
}

/**
 * WorkbenchTaskDetailSheet 展示任务详情和停止入口，所有文本来自 display 数据。
 */
export function WorkbenchTaskDetailSheet(props: WorkbenchTaskDetailSheetProps): JSX.Element {
  return (
    <Sheet
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close();
        }
      }}
    >
      <SheetContent side="right" className="workbench-task__sheet">
        <SheetHeader className="sr-only">
          <SheetTitle>{props.display.title}</SheetTitle>
          <SheetDescription>{props.display.description}</SheetDescription>
        </SheetHeader>

        <div className="workbench-task__sheet-body">
          <section className="workbench-task__section">
            <div className="workbench-task__section-head workbench-task__section-head--inline">
              <h3 className="workbench-task__section-title">{props.display.waveform_title}</h3>
              <span
                className={cn(
                  "workbench-task__percent-pill",
                  resolve_percent_pill_tone_class_name(props.display.percent_tone),
                )}
              >
                {props.display.completion_percent_text}
              </span>
            </div>
            <WorkbenchTaskWaveform history={props.display.waveform_history} />
          </section>

          <section className="workbench-task__section">
            <div className="workbench-task__section-head">
              <h3 className="workbench-task__section-title">{props.display.metrics_title}</h3>
            </div>
            <div className="workbench-task__metrics-grid">
              {props.display.metric_entries.map((entry) => (
                <article key={entry.key} className="workbench-task__metric">
                  <div className="workbench-task__metric-head">
                    <span className="workbench-task__metric-label">{entry.label}</span>
                  </div>
                  <div className="workbench-task__metric-main">
                    <span className="workbench-task__metric-value">{entry.value_text}</span>
                    <span className="workbench-task__metric-unit">{entry.unit_text}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="workbench-task__sheet-footer">
          <AppButton
            type="button"
            variant="destructive"
            disabled={props.display.stop_disabled}
            onClick={props.on_request_stop_confirmation}
          >
            <CircleStop data-icon="inline-start" />
            {props.display.stop_button_label}
          </AppButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
