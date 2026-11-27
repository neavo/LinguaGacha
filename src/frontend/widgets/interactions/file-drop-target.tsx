import { type JSX, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import "./file-drop-target.css";
import { useWindowDeactivation } from "@frontend/widgets/interactions/use-window-deactivation";

type FileDropTargetProps = {
  target_ref: RefObject<HTMLElement | null>; // 遮罩与拖放事件都属于包含本组件的区域。
  enabled: boolean;
  label: string;
  on_files: (files: readonly File[]) => void;
};

/** 接收区域只负责文件事件与反馈，消费方决定工程打开或编辑器输入。 */
export function FileDropTarget({
  target_ref,
  enabled,
  on_files,
  label,
}: FileDropTargetProps): JSX.Element {
  const [active, set_active] = useState(false);
  const depth_ref = useRef(0); // 子元素间移动也会产生 enter / leave，归零才代表离开区域

  /** 禁用、失焦和放下文件共用同一清理入口。 */
  function reset(): void {
    depth_ref.current = 0;
    set_active(false);
  }

  useWindowDeactivation(reset);
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled]);

  /** 文件禁用时也阻止默认打开；文本拖选和队列排序保留原生传播。 */
  const handle_drag = useEffectEvent((event: DragEvent): void => {
    const transfer = event.dataTransfer;
    if (transfer === null || !Array.from(transfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    switch (event.type) {
      case "dragenter":
        if (!enabled) return;
        depth_ref.current += 1;
        set_active(true);
        break;
      case "dragover":
        transfer.dropEffect = enabled ? "copy" : "none";
        break;
      case "dragleave":
        depth_ref.current = Math.max(0, depth_ref.current - 1);
        if (depth_ref.current === 0) set_active(false);
        break;
      case "drop":
        reset();
        if (enabled) on_files(Array.from(transfer.files));
        break;
    }
  });

  useEffect(() => {
    const element = target_ref.current;
    if (element === null) return;
    // 在冒泡阶段由最近的接收区域处理，外层不会重复添加文件或改写 dropEffect。
    const events = ["dragenter", "dragover", "dragleave", "drop"] as const;
    for (const type of events) element.addEventListener(type, handle_drag);
    return () => {
      for (const type of events) element.removeEventListener(type, handle_drag);
    };
  }, [target_ref]);

  const visible = active && enabled;
  return (
    <div
      className="file-drop-overlay"
      data-active={visible ? "true" : undefined}
      aria-hidden={!visible}
    >
      {label}
    </div>
  );
}
