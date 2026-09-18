import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useWindowDeactivation } from "@frontend/widgets/interactions/use-window-deactivation";

type AgentImageDropTargetProps = {
  target_ref: RefObject<HTMLElement | null>;
  enabled: boolean;
  on_files: (files: readonly File[]) => Promise<void>;
};

/** 编辑器拥有图片输入能力；接收区域只负责文件事件和同一区域内的反馈。 */
export function AgentImageDropTarget({
  target_ref,
  enabled,
  on_files,
}: AgentImageDropTargetProps): JSX.Element | null {
  const { t } = useI18n();
  const [target, set_target] = useState<HTMLElement | null>(null);
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
        if (enabled) void on_files(Array.from(transfer.files));
        break;
    }
  });

  useEffect(() => {
    const element = target_ref.current;
    if (element === null) return;
    set_target(element);
    // 绑定真实区域的冒泡阶段：局部编辑器先消费文件，页面不会重复添加或覆盖 dropEffect。
    const events = ["dragenter", "dragover", "dragleave", "drop"] as const;
    for (const type of events) element.addEventListener(type, handle_drag);
    return () => {
      for (const type of events) element.removeEventListener(type, handle_drag);
    };
  }, [target_ref]);

  return target === null
    ? null
    : createPortal(
        <div
          className="agent-image-drop-overlay"
          data-active={active && enabled ? "true" : undefined}
          aria-hidden={!active || !enabled}
        >
          {t("agent_page.input.drop_images")}
        </div>,
        target,
      );
}
