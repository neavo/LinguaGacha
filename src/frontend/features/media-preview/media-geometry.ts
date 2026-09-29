export type MediaSize = { width: number; height: number };
export type MediaPoint = { x: number; y: number };

export type MediaImage = Readonly<{ url: string; mime: string }>;
export type MediaMode = "image" | "document";

/** 输入为图像固有尺寸与 CSS 视口；位图按 DPR 限制原始像素，文档优先填满阅读区域。 */
export function calculate_media_fit_scale(
  viewport: MediaSize,
  media: MediaSize,
  pixel_ratio: number,
  mode: MediaMode,
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || media.width <= 0 || media.height <= 0) {
    return 0;
  }
  return Math.min(
    viewport.width / media.width,
    viewport.height / media.height,
    mode === "document" ? Infinity : 1 / pixel_ratio,
  );
}

/** 以“相对适应尺寸”的缩放倍率计算可平移边界。 */
export function clamp_media_pan(
  pan: MediaPoint,
  viewport: MediaSize,
  media: MediaSize,
  fit_scale: number,
  zoom: number,
): MediaPoint {
  const max_x = Math.max(0, (media.width * fit_scale * zoom - viewport.width) / 2);
  const max_y = Math.max(0, (media.height * fit_scale * zoom - viewport.height) / 2);
  return {
    x: Math.min(max_x, Math.max(-max_x, pan.x)),
    y: Math.min(max_y, Math.max(-max_y, pan.y)),
  };
}
