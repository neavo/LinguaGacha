import { type JSX, type DragEvent, useRef, useState, type ReactNode } from "react";

import {
  has_path_drop_payload,
  resolve_dropped_paths,
} from "@frontend/app/desktop/file-drop-paths";
import { cn } from "@frontend/shadcn/classnames";
import "@frontend/widgets/file-drop-zone/file-drop-zone.css";

type FileDropIssue = "multiple" | "unavailable";

// 回调形状决定单选或批量，避免多选配置把路径静默截成首项。
type FileDropZoneProps = {
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  on_drop_issue?: (issue: FileDropIssue) => void;
} & (
  | { on_path_drop: (path: string) => void | Promise<void>; on_paths_drop?: never }
  | { on_paths_drop: (paths: string[]) => void | Promise<void>; on_path_drop?: never }
);

/** 组件拥有拖放反馈与路径选择，文件读写由调用者接管。 */
export function FileDropZone(props: FileDropZoneProps): JSX.Element {
  const drag_depth_ref = useRef(0);
  const [drop_active, set_drop_active] = useState(false);

  /** 落下文件后同时清空嵌套深度与高亮，避免残留拖入状态。 */
  function reset_drop_state(): void {
    drag_depth_ref.current = 0;
    set_drop_active(false);
  }

  /** 只接纳文件载荷，累计子元素间的拖入深度以稳定高亮。 */
  function handle_drag_enter(event: DragEvent<HTMLDivElement>): void {
    if (props.disabled || !has_path_drop_payload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    drag_depth_ref.current += 1;
    set_drop_active(true);
    event.dataTransfer.dropEffect = "copy";
  }

  /** 持续允许复制文件，使浏览器在当前区域触发落下事件。 */
  function handle_drag_over(event: DragEvent<HTMLDivElement>): void {
    if (props.disabled || !has_path_drop_payload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    if (!drop_active) {
      set_drop_active(true);
    }
    event.dataTransfer.dropEffect = "copy";
  }

  /** 直到退出最外层区域才清除高亮，避免经过子元素时闪烁。 */
  function handle_drag_leave(event: DragEvent<HTMLDivElement>): void {
    if (props.disabled || !has_path_drop_payload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    drag_depth_ref.current = Math.max(0, drag_depth_ref.current - 1);
    if (drag_depth_ref.current === 0) {
      set_drop_active(false);
    }
  }

  /** 先结束拖放反馈，再解析宿主路径并按单选或多选契约分发。 */
  async function handle_drop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    reset_drop_state();

    if (props.disabled) {
      return;
    }

    const paths = resolve_dropped_paths(event.dataTransfer);
    if (paths.length > 1 && props.on_paths_drop === undefined) {
      props.on_drop_issue?.("multiple");
      return;
    }

    if (paths.length === 0) {
      props.on_drop_issue?.("unavailable");
      return;
    }

    if (props.on_paths_drop !== undefined) {
      await props.on_paths_drop(paths);
      return;
    }

    await props.on_path_drop(paths[0]!);
  }

  return (
    <div
      className={cn("file-drop-zone", props.className)}
      data-drop-active={drop_active ? "true" : undefined}
      onDragEnter={handle_drag_enter}
      onDragOver={handle_drag_over}
      onDragLeave={handle_drag_leave}
      onDrop={(event) => {
        void handle_drop(event);
      }}
    >
      <div className="file-drop-zone__content">{props.children}</div>
      <div className="file-drop-zone__overlay" aria-hidden={!drop_active}>
        <p className="file-drop-zone__label font-medium">{props.label}</p>
      </div>
    </div>
  );
}
