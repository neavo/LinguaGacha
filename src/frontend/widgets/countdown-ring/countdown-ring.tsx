import type { JSX, ReactNode } from "react";
import { cn } from "@frontend/shadcn/classnames";
import "@frontend/widgets/status-mark.css";
import "./countdown-ring.css";

const WARNING_REMAINING_PERCENT = 25; // 最后四分之一期限切换为警告语义

/** 小尺寸下按 viewBox 缩放比例加粗描边，保持与卡片倒计时圈视觉等粗。 */
const RING_GEOMETRY = {
  sm: { radius: 10, strokeWidth: 3 },
  md: { radius: 10.75, strokeWidth: 1.5 },
} as const;

type CountdownRingSize = keyof typeof RING_GEOMETRY;

type CountdownRingProps = {
  remaining_percent: number;
  size?: CountdownRingSize;
  className?: string;
  "aria-hidden"?: boolean;
  children?: ReactNode;
};

/** 统一决策卡片与侧边栏的倒计时圆环、警告变色与扩散光环。 */
export function CountdownRing({
  remaining_percent,
  size = "md",
  className,
  "aria-hidden": aria_hidden,
  children,
}: CountdownRingProps): JSX.Element {
  const geometry = RING_GEOMETRY[size];

  return (
    <span
      className={cn("countdown-ring", `countdown-ring--${size}`, className)}
      data-warning={remaining_percent <= WARNING_REMAINING_PERCENT ? "true" : undefined}
      aria-hidden={aria_hidden}
    >
      <svg
        className="countdown-ring__svg"
        viewBox="-12 -12 24 24"
        strokeWidth={geometry.strokeWidth}
        aria-hidden="true"
      >
        <circle className="countdown-ring__track" r={geometry.radius} />
        <circle
          className="countdown-ring__value"
          r={geometry.radius}
          pathLength="100"
          style={{ strokeDashoffset: 100 - remaining_percent }}
        />
      </svg>
      {children}
    </span>
  );
}
