import type { CSSProperties } from 'react'

function build_progress_value(progress_percent?: number): number | null {
  if (progress_percent === undefined || Number.isNaN(progress_percent)) {
    return null
  }

  return Math.max(0, Math.min(100, progress_percent))
}

export function ProgressToastRing(props: { progress_percent?: number }): JSX.Element {
  const normalized_progress = build_progress_value(props.progress_percent)
  const ring_radius = 13
  const ring_circumference = 2 * Math.PI * ring_radius
  const dash_offset = normalized_progress === null
    ? ring_circumference * 0.28
    : ring_circumference - (normalized_progress / 100) * ring_circumference
  const stroke_style: CSSProperties | undefined = normalized_progress === null
    ? undefined
    : {
        strokeDasharray: `${ring_circumference}`,
        strokeDashoffset: `${dash_offset}`,
      }

  return (
    <span
      className={normalized_progress === null ? 'cn-progress-ring cn-progress-ring--indeterminate' : 'cn-progress-ring'}
      aria-hidden="true"
    >
      <svg className="cn-progress-ring__svg" viewBox="0 0 32 32">
        <circle className="cn-progress-ring__track" cx="16" cy="16" r={ring_radius} />
        <circle className="cn-progress-ring__stroke" cx="16" cy="16" r={ring_radius} style={stroke_style} />
      </svg>
    </span>
  )
}
