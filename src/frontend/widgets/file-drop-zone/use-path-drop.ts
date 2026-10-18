import { type DragEvent, useRef, useState } from "react";

import {
  has_path_drop_payload,
  resolve_dropped_paths,
} from "@frontend/app/desktop/file-drop-paths";

export type PathDropIssue = "multiple" | "unavailable";

// 回调形状决定单选或批量，避免多选配置把路径静默截成首项。
export type PathDropOptions = {
  disabled?: boolean;
  on_drop_issue?: (issue: PathDropIssue) => void;
} & (
  | { on_path_drop: (path: string) => void | Promise<void>; on_paths_drop?: never }
  | { on_paths_drop: (paths: string[]) => void | Promise<void>; on_path_drop?: never }
);

/** 拥有拖放高亮与宿主路径分发，呈现方式和路径用途由调用者决定。 */
export function usePathDrop(options: PathDropOptions) {
  const drag_depth_ref = useRef(0); // 嵌套元素的进入和离开事件共用一次外层拖放。
  const [drop_active, set_drop_active] = useState(false);

  /** 落下文件后同时清空嵌套深度与高亮，避免残留拖入状态。 */
  function reset_drop_state(): void {
    drag_depth_ref.current = 0;
    set_drop_active(false);
  }

  /** 文件载荷总是拦截默认行为，禁用时改为禁止落下，避免宿主直接打开文件。 */
  function accept_drag(event: DragEvent<HTMLElement>): boolean {
    if (!has_path_drop_payload(event.dataTransfer)) {
      return false;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = options.disabled ? "none" : "copy";
    return !options.disabled;
  }

  /** 累计子元素间的拖入深度以稳定高亮。 */
  function handle_drag_enter(event: DragEvent<HTMLElement>): void {
    if (!accept_drag(event)) {
      return;
    }

    drag_depth_ref.current += 1;
    set_drop_active(true);
  }

  /** 持续允许复制文件，使浏览器在当前区域触发落下事件。 */
  function handle_drag_over(event: DragEvent<HTMLElement>): void {
    if (!accept_drag(event)) {
      if (drop_active) {
        reset_drop_state(); // 拖入途中被禁用时立即撤销高亮。
      }
      return;
    }

    set_drop_active(true);
  }

  /** 直到退出最外层区域才清除高亮，避免经过子元素时闪烁。 */
  function handle_drag_leave(event: DragEvent<HTMLElement>): void {
    if (!has_path_drop_payload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    drag_depth_ref.current = Math.max(0, drag_depth_ref.current - 1);
    if (drag_depth_ref.current === 0) {
      set_drop_active(false);
    }
  }

  /** 先结束拖放反馈，再解析宿主路径并按单选或多选契约分发。 */
  async function handle_drop(event: DragEvent<HTMLElement>): Promise<void> {
    event.preventDefault();
    reset_drop_state();

    if (options.disabled) {
      return;
    }

    const paths = resolve_dropped_paths(event.dataTransfer);
    if (paths.length > 1 && options.on_paths_drop === undefined) {
      options.on_drop_issue?.("multiple");
      return;
    }

    if (paths.length === 0) {
      options.on_drop_issue?.("unavailable");
      return;
    }

    if (options.on_paths_drop !== undefined) {
      await options.on_paths_drop(paths);
      return;
    }

    await options.on_path_drop(paths[0]!);
  }

  return {
    drop_active,
    drop_handlers: {
      onDragEnter: handle_drag_enter,
      onDragOver: handle_drag_over,
      onDragLeave: handle_drag_leave,
      onDrop: (event: DragEvent<HTMLElement>) => {
        void handle_drop(event);
      },
    },
  };
}
