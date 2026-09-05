import { CircleStop } from "lucide-react";

import "./workbench-task.css";
import { cn } from "@frontend/shadcn/classnames";
import type {
  WorkbenchTranslationDetailDisplay,
  WorkbenchTranslationTone,
} from "@frontend/pages/workbench-page/types";
import { WorkbenchTranslationWaveform } from "@frontend/pages/workbench-page/components/workbench-translation-waveform";
import { AppButton } from "@frontend/widgets/app-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@frontend/shadcn/sheet";

type WorkbenchTranslationDetailSheetProps = {
  open: boolean;
  display: WorkbenchTranslationDetailDisplay;
  on_close: () => void;
  on_request_stop_confirmation: () => void;
};

function resolve_percent_pill_tone_class_name(tone: WorkbenchTranslationTone): string {
  if (tone === "warning") {
    return "workbench-task__percent-pill--warning";
  }

  if (tone === "success") {
    return "workbench-task__percent-pill--success";
  }

  return "workbench-task__percent-pill--neutral";
}

/**
 * WorkbenchTranslationDetailSheet 展示任务详情和停止入口，所有文本来自 display 数据。
 */
export function WorkbenchTranslationDetailSheet(
  props: WorkbenchTranslationDetailSheetProps,
): JSX.Element {
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
            <WorkbenchTranslationWaveform history={props.display.waveform_history} />
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
                    {entry.unit_text === "" ? null : (
                      <span className="workbench-task__metric-unit">{entry.unit_text}</span>
                    )}
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
