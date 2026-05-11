import { useEffect, useMemo, useRef } from "react";
import { CircleStop } from "lucide-react";

import "./task-runtime.css";
import { cn } from "@/lib/utils";
import { WORKBENCH_WAVEFORM_VISIBLE_POINTS } from "@/pages/workbench-page/task-runtime/workbench-waveform";
import type { WorkbenchTaskDetailViewModel, WorkbenchTaskTone } from "@/pages/workbench-page/types";
import { AppButton } from "@/widgets/app-button/app-button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shadcn/sheet";

type TaskRuntimeDetailSheetProps = {
  open: boolean;
  view_model: WorkbenchTaskDetailViewModel;
  on_close: () => void;
  on_request_stop_confirmation: () => void;
};

const WAVEFORM_COLUMN_COUNT = WORKBENCH_WAVEFORM_VISIBLE_POINTS;
const WAVEFORM_ROW_COUNT = 24;
const WAVEFORM_COLUMN_STEP_PX = 5;
const WAVEFORM_ROW_STEP_PX = 4;
const WAVEFORM_FONT_SIZE_PX = 6;
const WAVEFORM_CANVAS_WIDTH = WAVEFORM_COLUMN_COUNT * WAVEFORM_COLUMN_STEP_PX;
const WAVEFORM_CANVAS_HEIGHT = WAVEFORM_ROW_COUNT * WAVEFORM_ROW_STEP_PX;

function normalize_waveform_values(history: number[]): number[] {
  if (history.length === 0) {
    return [0];
  }

  const min_value = Math.min(...history);
  const max_value = Math.max(...history);

  if (max_value - min_value === 0 && history[0] === 0) {
    return history.map(() => 0);
  }

  if (max_value - min_value === 0 && history[0] !== 0) {
    return history.map(() => 1);
  }

  return history.map((value) => {
    return (value - min_value) / (max_value - min_value);
  });
}

function build_waveform_columns(history: number[]): number[] {
  if (history.length === 0) {
    return [];
  }

  const visible_history =
    history.length >= WAVEFORM_COLUMN_COUNT
      ? history.slice(history.length - WAVEFORM_COLUMN_COUNT)
      : history;
  const normalized_values = normalize_waveform_values(visible_history);

  return normalized_values.map((value) => {
    return Math.floor(value * (WAVEFORM_ROW_COUNT - 1) + 1);
  });
}

function resolve_percent_pill_tone_class_name(tone: WorkbenchTaskTone): string {
  if (tone === "warning") {
    return "task-runtime__percent-pill--warning";
  }

  if (tone === "success") {
    return "task-runtime__percent-pill--success";
  }

  return "task-runtime__percent-pill--neutral";
}

function TaskWaveform(props: { history: number[] }): JSX.Element {
  const canvas_ref = useRef<HTMLCanvasElement | null>(null);

  const column_heights = useMemo(() => {
    return build_waveform_columns(props.history);
  }, [props.history]);

  useEffect(() => {
    const canvas_element = canvas_ref.current;
    if (canvas_element === null) {
      return;
    }

    const context = canvas_element.getContext("2d");
    if (context === null) {
      return;
    }

    const device_pixel_ratio = window.devicePixelRatio || 1;
    canvas_element.width = Math.round(WAVEFORM_CANVAS_WIDTH * device_pixel_ratio);
    canvas_element.height = Math.round(WAVEFORM_CANVAS_HEIGHT * device_pixel_ratio);
    context.setTransform(device_pixel_ratio, 0, 0, device_pixel_ratio, 0, 0);
    context.clearRect(0, 0, WAVEFORM_CANVAS_WIDTH, WAVEFORM_CANVAS_HEIGHT);
    context.imageSmoothingEnabled = false;
    context.font = `${WAVEFORM_FONT_SIZE_PX}px Consolas, "Cascadia Mono", "Courier New", monospace`;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";

    const computed_style = window.getComputedStyle(canvas_element);
    context.fillStyle = computed_style.color || "#6f5d3d";
    const x_offset = WAVEFORM_CANVAS_WIDTH - column_heights.length * WAVEFORM_COLUMN_STEP_PX;
    const baseline_y = WAVEFORM_CANVAS_HEIGHT;

    // 为什么：先铺底座字符，能让空样本和低波动样本仍然保留稳定的“监视器”视觉反馈。
    for (let column_index = 0; column_index < WAVEFORM_COLUMN_COUNT; column_index += 1) {
      const draw_x = column_index * WAVEFORM_COLUMN_STEP_PX + WAVEFORM_COLUMN_STEP_PX / 2;
      context.fillText("▨", draw_x, baseline_y);
    }

    column_heights.forEach((column_height, column_index) => {
      const draw_x =
        x_offset + column_index * WAVEFORM_COLUMN_STEP_PX + WAVEFORM_COLUMN_STEP_PX / 2;

      for (let row_index = 1; row_index < column_height; row_index += 1) {
        const draw_y = WAVEFORM_CANVAS_HEIGHT - row_index * WAVEFORM_ROW_STEP_PX;
        context.fillText("▨", draw_x, draw_y);
      }
    });
  }, [column_heights]);

  return (
    <div className="task-runtime__waveform">
      <canvas ref={canvas_ref} className="task-runtime__waveform-canvas" aria-hidden="true" />
    </div>
  );
}

export function TaskRuntimeDetailSheet(props: TaskRuntimeDetailSheetProps): JSX.Element {
  return (
    <Sheet
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close();
        }
      }}
    >
      <SheetContent side="right" className="task-runtime__sheet">
        <SheetHeader className="sr-only">
          <SheetTitle>{props.view_model.title}</SheetTitle>
          <SheetDescription>{props.view_model.description}</SheetDescription>
        </SheetHeader>

        <div className="task-runtime__sheet-body">
          <section className="task-runtime__section">
            <div className="task-runtime__section-head task-runtime__section-head--inline">
              <h3 className="task-runtime__section-title">{props.view_model.waveform_title}</h3>
              <span
                className={cn(
                  "task-runtime__percent-pill",
                  resolve_percent_pill_tone_class_name(props.view_model.percent_tone),
                )}
              >
                {props.view_model.completion_percent_text}
              </span>
            </div>
            <TaskWaveform history={props.view_model.waveform_history} />
          </section>

          <section className="task-runtime__section">
            <div className="task-runtime__section-head">
              <h3 className="task-runtime__section-title">{props.view_model.metrics_title}</h3>
            </div>
            <div className="task-runtime__metrics-grid">
              {props.view_model.metric_entries.map((entry) => (
                <article key={entry.key} className="task-runtime__metric">
                  <div className="task-runtime__metric-head">
                    <span className="task-runtime__metric-label">{entry.label}</span>
                  </div>
                  <div className="task-runtime__metric-main">
                    <span className="task-runtime__metric-value">{entry.value_text}</span>
                    <span className="task-runtime__metric-unit">{entry.unit_text}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="task-runtime__sheet-footer">
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
