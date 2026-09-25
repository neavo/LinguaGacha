import {
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import "./media-viewport.css";
import {
  type MediaSize,
  type MediaPoint,
  calculate_media_fit_scale,
  clamp_media_pan,
} from "./media-geometry";

// 缩放范围与步长只定义画布手感，不属于媒体协议。
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

type MediaViewportProps = {
  label: string;
  children: ReactNode;
  extra_controls?: ReactNode;
};

/** 图标按钮的可见提示与辅助名称使用同一文案。 */
export function MediaControl(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppButton
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          >
            {props.children}
          </AppButton>
        }
      />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

/** 图片与图表共用的居中画布；内容身份变化由调用方通过 key 重置视图。 */
export function MediaViewport(props: MediaViewportProps): JSX.Element {
  const { t } = useI18n();
  const viewport_ref = useRef<HTMLDivElement | null>(null);
  const media_ref = useRef<HTMLDivElement | null>(null);
  const drag_ref = useRef<{
    pointer_id: number;
    start: MediaPoint;
    pan: MediaPoint;
  } | null>(null);
  const [viewport, set_viewport] = useState<MediaSize>({ width: 0, height: 0 }); // 视口尺寸与媒体固有尺寸分别测量。
  const [media, set_media] = useState<MediaSize>({ width: 0, height: 0 });
  const [zoom, set_zoom] = useState(1); // 倍率相对于居中适应尺寸。
  const [pan, set_pan] = useState<MediaPoint>({ x: 0, y: 0 }); // 平移以画布中心为原点。
  const [dragging, set_dragging] = useState(false);
  const fit_scale = calculate_media_fit_scale(viewport, media);
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
    (next_pan: MediaPoint, next_zoom = zoom): MediaPoint =>
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
    (next_zoom: number, pointer: MediaPoint = { x: 0, y: 0 }): void => {
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

  // 图片加载和弹窗尺寸变化都可能改变适应比例。
  useEffect(() => {
    const viewport_element = viewport_ref.current;
    const media_element = media_ref.current;
    if (viewport_element === null || media_element === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport_element);
    observer.observe(media_element);
    measure();
    return () => observer.disconnect();
  }, [measure]);

  // 尺寸变化后重新夹取旧平移，避免媒体停留在新的可见范围外。
  useEffect(() => {
    if (!ready) return;
    set_pan((current_pan) => clamp_pan(current_pan));
  }, [clamp_pan, ready]);

  /** 滚轮围绕当前指针连续缩放。 */
  useEffect(() => {
    const element = viewport_ref.current;
    if (element === null) return;
    const handle_wheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoom_to(zoom * Math.pow(ZOOM_STEP, -event.deltaY / 100), {
        x: event.clientX - (rect.left + rect.width / 2),
        y: event.clientY - (rect.top + rect.height / 2),
      });
    };
    // 原生非 passive 监听确保滚轮只缩放画布，不滚动弹窗或外层页面。
    element.addEventListener("wheel", handle_wheel, { passive: false });
    return () => element.removeEventListener("wheel", handle_wheel);
  }, [zoom, zoom_to]);

  /** 仅在媒体超出视口时接管主指针拖动。 */
  const handle_pointer_down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as Element).closest("button") !== null || !ready)
      return;
    event.currentTarget.focus({ preventScroll: true });
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
    <div
      ref={viewport_ref}
      className={`media-viewport__viewport${dragging ? " is-dragging" : ""}`}
      tabIndex={0}
      role="group"
      aria-label={props.label}
      onPointerDown={handle_pointer_down}
      onPointerMove={handle_pointer_move}
      onPointerUp={stop_drag}
      onPointerCancel={stop_drag}
      onLostPointerCapture={stop_drag}
      onDragStart={(event) => event.preventDefault()}
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
      <div className="media-viewport__controls" role="toolbar" aria-label={props.label}>
        <MediaControl
          label={t("app.media.zoom_out")}
          disabled={!ready || zoom <= MIN_ZOOM}
          onClick={() => zoom_to(zoom / ZOOM_STEP)}
        >
          <ZoomOut aria-hidden="true" />
        </MediaControl>
        <MediaControl
          label={t("app.media.zoom_in")}
          disabled={!ready || zoom >= MAX_ZOOM}
          onClick={() => zoom_to(zoom * ZOOM_STEP)}
        >
          <ZoomIn aria-hidden="true" />
        </MediaControl>
        <MediaControl label={t("app.media.reset_zoom")} disabled={!ready} onClick={reset_view}>
          <RotateCcw aria-hidden="true" />
        </MediaControl>
        {props.extra_controls}
      </div>
      <div
        ref={media_ref}
        className="media-viewport__media"
        style={{ visibility: ready ? "visible" : "hidden" }}
      >
        <div
          className="media-viewport__content"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${fit_scale * zoom})`,
          }}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
