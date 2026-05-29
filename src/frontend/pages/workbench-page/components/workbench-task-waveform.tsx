import { useEffect, useMemo, useRef } from "react";

import {
  build_task_waveform_columns,
  TASK_WAVEFORM_VISIBLE_POINTS,
} from "@frontend/app/session/workbench-tasks/workbench-task-waveform-state";

type WorkbenchTaskWaveformProps = {
  history: number[];
};

const WAVEFORM_COLUMN_COUNT = TASK_WAVEFORM_VISIBLE_POINTS;
const WAVEFORM_ROW_COUNT = 24;
const WAVEFORM_COLUMN_STEP_PX = 5;
const WAVEFORM_ROW_STEP_PX = 4;
const WAVEFORM_FONT_SIZE_PX = 6;
const WAVEFORM_CANVAS_WIDTH = WAVEFORM_COLUMN_COUNT * WAVEFORM_COLUMN_STEP_PX;
const WAVEFORM_CANVAS_HEIGHT = WAVEFORM_ROW_COUNT * WAVEFORM_ROW_STEP_PX;

export function WorkbenchTaskWaveform(props: WorkbenchTaskWaveformProps): JSX.Element {
  const canvas_ref = useRef<HTMLCanvasElement | null>(null);

  const column_heights = useMemo(() => {
    return build_task_waveform_columns(props.history, WAVEFORM_ROW_COUNT);
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
    <div className="workbench-task__waveform">
      <canvas ref={canvas_ref} className="workbench-task__waveform-canvas" aria-hidden="true" />
    </div>
  );
}
