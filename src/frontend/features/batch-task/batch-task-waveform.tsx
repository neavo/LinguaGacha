import { useDevicePixelRatio } from "@frontend/widgets/interactions/use-device-pixel-ratio";
import { type JSX, useEffect, useRef } from "react";

import { TASK_WAVEFORM_VISIBLE_POINTS } from "@frontend/app/session/batch-task/batch-task-waveform-state";

type BatchTaskWaveformProps = {
  history: readonly number[];
};

const WAVEFORM_COLUMN_COUNT = TASK_WAVEFORM_VISIBLE_POINTS;
const WAVEFORM_ROW_COUNT = 24;
const WAVEFORM_COLUMN_STEP_PX = 5;
const WAVEFORM_ROW_STEP_PX = 4;
const WAVEFORM_FONT_SIZE_PX = 6;
const WAVEFORM_CANVAS_WIDTH = WAVEFORM_COLUMN_COUNT * WAVEFORM_COLUMN_STEP_PX;
const WAVEFORM_CANVAS_HEIGHT = WAVEFORM_ROW_COUNT * WAVEFORM_ROW_STEP_PX;

/** 按设备像素比绘制会话采样的波形，颜色沿用当前主题。 */
export function BatchTaskWaveform(props: BatchTaskWaveformProps): JSX.Element {
  const device_pixel_ratio = useDevicePixelRatio();
  const canvas_ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas_element = canvas_ref.current;
    if (canvas_element === null) {
      return;
    }

    const context = canvas_element.getContext("2d");
    if (context === null) {
      return;
    }

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
    const peak_speed = Math.max(1, ...props.history); // 按可见样本峰值缩放，保留底座一行。
    const x_offset = WAVEFORM_CANVAS_WIDTH - props.history.length * WAVEFORM_COLUMN_STEP_PX;
    const baseline_y = WAVEFORM_CANVAS_HEIGHT;

    // 先铺底座，空闲时也有静态波形。
    for (let column_index = 0; column_index < WAVEFORM_COLUMN_COUNT; column_index += 1) {
      const draw_x = column_index * WAVEFORM_COLUMN_STEP_PX + WAVEFORM_COLUMN_STEP_PX / 2;
      context.fillText("▨", draw_x, baseline_y);
    }

    props.history.forEach((speed, column_index) => {
      const filled_rows = Math.round(((WAVEFORM_ROW_COUNT - 1) * speed) / peak_speed);
      const draw_x =
        x_offset + column_index * WAVEFORM_COLUMN_STEP_PX + WAVEFORM_COLUMN_STEP_PX / 2;

      for (let row_index = 1; row_index <= filled_rows; row_index += 1) {
        const draw_y = WAVEFORM_CANVAS_HEIGHT - row_index * WAVEFORM_ROW_STEP_PX;
        context.fillText("▨", draw_x, draw_y);
      }
    });
  }, [props.history, device_pixel_ratio]);

  return (
    <div className="batch-translation__waveform">
      <canvas ref={canvas_ref} className="batch-translation__waveform-canvas" aria-hidden="true" />
    </div>
  );
}
