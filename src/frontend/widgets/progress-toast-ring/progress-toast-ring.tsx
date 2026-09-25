import type { JSX, CSSProperties } from "react";
import "@frontend/widgets/progress-toast-ring/progress-toast-ring.css";

/** 未知进度使用不定动画，已知进度限制在可绘制的百分比范围。 */
function build_progress_value(progress_percent?: number): number | null {
  if (progress_percent === undefined || Number.isNaN(progress_percent)) {
    return null;
  }

  return Math.max(0, Math.min(100, progress_percent));
}

/** 以同一圆环呈现已知进度和等待状态，文案由外层通知提供。 */
export function ProgressToastRing(props: { progress_percent?: number | undefined }): JSX.Element {
  const normalized_progress = build_progress_value(props.progress_percent);
  const ring_radius = 13;
  const ring_circumference = 2 * Math.PI * ring_radius;
  const dash_offset =
    normalized_progress === null
      ? ring_circumference * 0.28
      : ring_circumference - (normalized_progress / 100) * ring_circumference;
  const stroke_style: CSSProperties | undefined =
    normalized_progress === null
      ? undefined
      : {
          strokeDasharray: `${ring_circumference}`,
          strokeDashoffset: `${dash_offset}`,
        };

  return (
    <span
      className={
        normalized_progress === null
          ? "cn-progress-ring cn-progress-ring--indeterminate"
          : "cn-progress-ring"
      }
      aria-hidden="true"
    >
      <svg className="cn-progress-ring__svg" viewBox="0 0 32 32">
        <circle className="cn-progress-ring__track" cx="16" cy="16" r={ring_radius} />
        <circle
          className="cn-progress-ring__stroke"
          cx="16"
          cy="16"
          r={ring_radius}
          style={stroke_style}
        />
      </svg>
    </span>
  );
}
