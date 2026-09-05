import { CircleStop } from "lucide-react";

import "./batch-translation.css";
import { cn } from "@frontend/shadcn/classnames";
import type { BatchTranslationDetailDisplay } from "@frontend/features/batch-translation/batch-translation-display";
import { BatchTranslationWaveform } from "@frontend/features/batch-translation/batch-translation-waveform";
import { AppButton } from "@frontend/widgets/app-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@frontend/shadcn/sheet";

type BatchTranslationDetailSheetProps = {
  open: boolean;
  display: BatchTranslationDetailDisplay;
  empty_text?: string;
  on_close: () => void;
  on_request_stop_confirmation: () => void;
};

/**
 * BatchTranslationDetailSheet 展示任务详情和停止入口，所有文本来自 display 数据。
 */
export function BatchTranslationDetailSheet(props: BatchTranslationDetailSheetProps): JSX.Element {
  return (
    <Sheet
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close();
        }
      }}
    >
      <SheetContent side="right" className="batch-translation__sheet">
        <SheetHeader className="sr-only">
          <SheetTitle>{props.display.metrics_title}</SheetTitle>
          <SheetDescription>{props.display.waveform_title}</SheetDescription>
        </SheetHeader>

        <div className="batch-translation__sheet-body">
          {props.empty_text !== undefined ? (
            <p className="text-muted-foreground">{props.empty_text}</p>
          ) : (
            <>
              <section className="batch-translation__section">
                <div className="batch-translation__section-head batch-translation__section-head--inline">
                  <h3 className="batch-translation__section-title">
                    {props.display.waveform_title}
                  </h3>
                  <span
                    className={cn(
                      "batch-translation__percent-pill",
                      `batch-translation__percent-pill--${props.display.percent_tone}`,
                    )}
                  >
                    {props.display.completion_percent_text}
                  </span>
                </div>
                <BatchTranslationWaveform history={props.display.waveform_history} />
              </section>

              <section className="batch-translation__section">
                <div className="batch-translation__section-head">
                  <h3 className="batch-translation__section-title">
                    {props.display.metrics_title}
                  </h3>
                </div>
                <div className="batch-translation__metrics-grid">
                  {props.display.metric_entries.map((entry) => (
                    <article key={entry.key} className="batch-translation__metric">
                      <div className="batch-translation__metric-head">
                        <span className="batch-translation__metric-label">{entry.label}</span>
                      </div>
                      <div className="batch-translation__metric-main">
                        <span className="batch-translation__metric-value">{entry.value_text}</span>
                        {entry.unit_text === "" ? null : (
                          <span className="batch-translation__metric-unit">{entry.unit_text}</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <div className="batch-translation__sheet-footer">
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
