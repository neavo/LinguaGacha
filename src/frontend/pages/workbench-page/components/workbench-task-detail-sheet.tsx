import { CircleStop } from "lucide-react";

import "./workbench-task.css";
import { cn } from "@frontend/styling/classnames";
import type {
  WorkbenchTaskDetailViewModel,
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
  view_model: WorkbenchTaskDetailViewModel;
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
          <SheetTitle>{props.view_model.title}</SheetTitle>
          <SheetDescription>{props.view_model.description}</SheetDescription>
        </SheetHeader>

        <div className="workbench-task__sheet-body">
          <section className="workbench-task__section">
            <div className="workbench-task__section-head workbench-task__section-head--inline">
              <h3 className="workbench-task__section-title">{props.view_model.waveform_title}</h3>
              <span
                className={cn(
                  "workbench-task__percent-pill",
                  resolve_percent_pill_tone_class_name(props.view_model.percent_tone),
                )}
              >
                {props.view_model.completion_percent_text}
              </span>
            </div>
            <WorkbenchTaskWaveform history={props.view_model.waveform_history} />
          </section>

          <section className="workbench-task__section">
            <div className="workbench-task__section-head">
              <h3 className="workbench-task__section-title">{props.view_model.metrics_title}</h3>
            </div>
            <div className="workbench-task__metrics-grid">
              {props.view_model.metric_entries.map((entry) => (
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
            disabled={props.view_model.stop_disabled}
            onClick={props.on_request_stop_confirmation}
          >
            <CircleStop data-icon="inline-start" />
            {props.view_model.stop_button_label}
          </AppButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
