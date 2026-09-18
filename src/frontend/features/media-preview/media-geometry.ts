export type MediaSize = { width: number; height: number };
export type MediaPoint = { x: number; y: number };

/** 计算不放大原图的适应比例。 */
export function calculate_media_fit_scale(viewport: MediaSize, media: MediaSize): number {
  if (viewport.width <= 0 || viewport.height <= 0 || media.width <= 0 || media.height <= 0) {
    return 0;
  }
  return Math.min(viewport.width / media.width, viewport.height / media.height, 1);
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
