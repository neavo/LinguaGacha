import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { AppButton } from "@frontend/widgets/app-button";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

import "./agent-media-preview-dialog.css";

// 缩放范围与步长只定义画布手感，不属于媒体协议。
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

export type AgentMediaSize = { width: number; height: number };
export type AgentMediaPoint = { x: number; y: number };

type AgentMediaPreviewDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
};

/** 计算不放大原图的适应比例。 */
export function calculate_media_fit_scale(viewport: AgentMediaSize, media: AgentMediaSize): number {
  if (viewport.width <= 0 || viewport.height <= 0 || media.width <= 0 || media.height <= 0) {
    return 0;
  }
  return Math.min(viewport.width / media.width, viewport.height / media.height, 1);
}

/** 以“相对适应尺寸”的缩放倍率计算可平移边界。 */
export function clamp_media_pan(
  pan: AgentMediaPoint,
  viewport: AgentMediaSize,
  media: AgentMediaSize,
  fit_scale: number,
  zoom: number,
): AgentMediaPoint {
  const max_x = Math.max(0, (media.width * fit_scale * zoom - viewport.width) / 2);
  const max_y = Math.max(0, (media.height * fit_scale * zoom - viewport.height) / 2);
  return {
    x: Math.min(max_x, Math.max(-max_x, pan.x)),
    y: Math.min(max_y, Math.max(-max_y, pan.y)),
  };
}

/** Agent 的图片与图表共用同一套无滚动条查看交互。 */
export function AgentMediaPreviewDialog(props: AgentMediaPreviewDialogProps): JSX.Element {
  const { t } = useI18n();
  const viewport_ref = useRef<HTMLDivElement | null>(null);
  const media_ref = useRef<HTMLDivElement | null>(null);
  const drag_ref = useRef<{
    pointer_id: number;
    start: AgentMediaPoint;
    pan: AgentMediaPoint;
  } | null>(null);
  const [viewport, set_viewport] = useState<AgentMediaSize>({ width: 0, height: 0 });
  const [media, set_media] = useState<AgentMediaSize>({ width: 0, height: 0 });
  const [zoom, set_zoom] = useState(1);
  const [pan, set_pan] = useState<AgentMediaPoint>({ x: 0, y: 0 });
  const [dragging, set_dragging] = useState(false);
  const fit_scale = useMemo(() => calculate_media_fit_scale(viewport, media), [media, viewport]);
  const ready = fit_scale > 0;

  /** 同时测量视口和媒体固有尺寸，确保二者变化后仍使用同一适应比例。 */
  const measure = useCallback((): void => {
    const viewport_element = viewport_ref.current;
    const media_element = media_ref.current;
    if (viewport_element === null || media_element === null) return;
    set_viewport({ width: viewport_element.clientWidth, height: viewport_element.clientHeight });
    set_media({ width: media_element.offsetWidth, height: media_element.offsetHeight });
  }, []);

  /** 把任意平移值收敛到当前尺寸与倍率允许的范围。 */
  const clamp_pan = useCallback(
    (next_pan: AgentMediaPoint, next_zoom = zoom): AgentMediaPoint =>
      clamp_media_pan(next_pan, viewport, media, fit_scale, next_zoom),
    [fit_scale, media, viewport, zoom],
  );

  /** 恢复适应画布的初始缩放与中心位置。 */
  const reset_view = useCallback((): void => {
    set_zoom(1);
    set_pan({ x: 0, y: 0 });
  }, []);

  /** 围绕指定画布坐标缩放，并保持该坐标下的媒体内容稳定。 */
  const zoom_to = useCallback(
    (next_zoom: number, pointer: AgentMediaPoint = { x: 0, y: 0 }): void => {
      if (!ready) return;
      const bounded_zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next_zoom));
      const ratio = bounded_zoom / zoom;
      const next_pan = {
        x: pointer.x - (pointer.x - pan.x) * ratio,
        y: pointer.y - (pointer.y - pan.y) * ratio,
      };
      set_zoom(bounded_zoom);
      set_pan(clamp_pan(next_pan, bounded_zoom));
    },
    [clamp_pan, pan.x, pan.y, ready, zoom],
  );

  // 每次打开都从适应状态开始，并在弹窗布局完成后的首帧读取尺寸。
  useLayoutEffect(() => {
    if (!props.open) return;
    reset_view();
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [measure, props.open, reset_view]);

  // 图片加载和弹窗尺寸变化都可能改变适应比例。
  useEffect(() => {
    if (!props.open) return;
    const viewport_element = viewport_ref.current;
    const media_element = media_ref.current;
    if (viewport_element === null || media_element === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport_element);
    observer.observe(media_element);
    return () => observer.disconnect();
  }, [measure, props.open]);

  // 尺寸变化后重新夹取旧平移，避免媒体停留在新的可见范围外。
  useEffect(() => {
    if (!ready) return;
    set_pan((current_pan) => clamp_pan(current_pan));
  }, [clamp_pan, ready]);

  /** 把视口坐标转换为以画布中心为原点的缩放坐标。 */
  const pointer_position = (event: { clientX: number; clientY: number }): AgentMediaPoint => {
    const viewport_element = viewport_ref.current;
    if (viewport_element === null) return { x: 0, y: 0 };
    const rect = viewport_element.getBoundingClientRect();
    return {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    };
  };

  /** 滚轮围绕当前指针连续缩放。 */
  const handle_wheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    zoom_to(zoom * Math.pow(ZOOM_STEP, -event.deltaY / 100), pointer_position(event));
  };

  /** 仅在媒体超出视口时接管主指针拖动。 */
  const handle_pointer_down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as Element).closest("button") !== null || !ready)
      return;
    const can_pan =
      media.width * fit_scale * zoom > viewport.width ||
      media.height * fit_scale * zoom > viewport.height;
    if (!can_pan) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag_ref.current = {
      pointer_id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      pan,
    };
    set_dragging(true);
  };

  /** 根据拖动起点计算平移，避免增量事件误差累积。 */
  const handle_pointer_move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = drag_ref.current;
    if (drag === null || drag.pointer_id !== event.pointerId) return;
    set_pan(
      clamp_pan({
        x: drag.pan.x + event.clientX - drag.start.x,
        y: drag.pan.y + event.clientY - drag.start.y,
      }),
    );
  };

  /** 结束当前指针拖动并释放捕获。 */
  const stop_drag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag_ref.current?.pointer_id !== event.pointerId) return;
    drag_ref.current = null;
    set_dragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <AppPageDialog
      open={props.open}
      size="xl"
      title={props.title}
      onClose={props.onClose}
      footer={props.footer}
      bodyClassName="agent-media-preview-dialog__body"
    >
      <div
        ref={viewport_ref}
        className={`agent-media-preview-dialog__viewport${dragging ? " is-dragging" : ""}`}
        tabIndex={0}
        role="group"
        aria-label={t("agent_page.media.canvas_label")}
        onWheel={handle_wheel}
        onPointerDown={handle_pointer_down}
        onPointerMove={handle_pointer_move}
        onPointerUp={stop_drag}
        onPointerCancel={stop_drag}
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoom_to(zoom * ZOOM_STEP);
          } else if (event.key === "-") {
            event.preventDefault();
            zoom_to(zoom / ZOOM_STEP);
          } else if (event.key === "0") {
            event.preventDefault();
            reset_view();
          }
        }}
      >
        <div
          className="agent-media-preview-dialog__controls"
          role="toolbar"
          aria-label={t("agent_page.media.controls_label")}
        >
          <AppButton
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("agent_page.media.zoom_out")}
            title={t("agent_page.media.zoom_out")}
            onClick={() => zoom_to(zoom / ZOOM_STEP)}
          >
            <ZoomOut aria-hidden="true" />
          </AppButton>
          <AppButton
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("agent_page.media.zoom_in")}
            title={t("agent_page.media.zoom_in")}
            onClick={() => zoom_to(zoom * ZOOM_STEP)}
          >
            <ZoomIn aria-hidden="true" />
          </AppButton>
          <AppButton
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("agent_page.media.reset_zoom")}
            title={t("agent_page.media.reset_zoom")}
            onClick={reset_view}
          >
            <RotateCcw aria-hidden="true" />
          </AppButton>
        </div>
        <div
          ref={media_ref}
          className="agent-media-preview-dialog__media"
          style={{ visibility: ready ? "visible" : "hidden" }}
        >
          <div
            className="agent-media-preview-dialog__content"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${fit_scale * zoom})`,
            }}
          >
            {props.children}
          </div>
        </div>
      </div>
    </AppPageDialog>
  );
}
