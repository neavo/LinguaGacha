import {
  type JSX,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MessageSquareQuote } from "lucide-react";
import {
  autoUpdate,
  flip,
  inline,
  offset,
  shift,
  useFloating,
  type VirtualElement,
} from "@floating-ui/react-dom";

import type { AgentResponseAnnotationAttachment } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { AgentResponseAnnotationEditor } from "./agent-response-annotation";

const MESSAGE = '[data-agent-annotation-message="true"]';
const EXCLUDED =
  '[data-agent-annotation-exclude], [data-streamdown="mermaid"], button, input, textarea, select, [contenteditable="true"]';

type AnnotationTarget = {
  selectedText: string;
  anchor: Required<VirtualElement> & {
    getClientRects: NonNullable<VirtualElement["getClientRects"]>;
  }; // 选区与编辑快照都提供完整定位几何。
  message: HTMLElement; // 回复拥有选择范围，也承接批注关闭后的焦点。
};
type AnnotationSelection = AnnotationTarget &
  ({ mode: "action" } | { mode: "editing"; comment: string });
type AgentResponseAnnotationSelectionProps = {
  children: ReactNode;
  disabled: boolean;
  on_add: (annotation: AgentResponseAnnotationAttachment) => void;
};

/** 原生选区由浏览器拥有，此组件统一同步动作条并冻结进入编辑的引用。 */
export function AgentResponseAnnotationSelection(
  props: AgentResponseAnnotationSelectionProps,
): JSX.Element {
  const { t } = useI18n();
  const root_ref = useRef<HTMLDivElement>(null);
  const action_ref = useRef<HTMLButtonElement>(null);
  const frame_ref = useRef<number | null>(null); // 同一帧共用一次选区读取。
  const selecting_ref = useRef(false); // 拖选结束后才展示动作条。
  const [selection, set_selection] = useState<AnnotationSelection | null>(null);
  const { refs, floatingStyles } = useFloating({
    open: selection !== null,
    elements: { reference: selection?.anchor ?? null },
    placement: "top",
    strategy: "fixed",
    middleware: [inline(), offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  /** 关闭与卸载共用同一个待执行读取的清理入口。 */
  const cancel_frame = useCallback((): void => {
    if (frame_ref.current !== null) cancelAnimationFrame(frame_ref.current);
    frame_ref.current = null;
  }, []);

  /** 结束选择并清理原生选区，避免后续事件重新打开旧动作条。 */
  const close = useCallback((): void => {
    cancel_frame();
    selecting_ref.current = false;
    set_selection(null);
    const native = window.getSelection();
    // 输入框和其他区域的选区仍由各自的交互拥有。
    if (native?.anchorNode && root_ref.current?.contains(native.anchorNode))
      native.removeAllRanges();
  }, [cancel_frame]);

  /** 从浮层主动退出时将焦点交还正文。 */
  const dismiss = (): void => {
    if (refs.floating.current?.contains(document.activeElement))
      selection?.message.focus({ preventScroll: true });
    close();
  };

  /** 动作条跟随浏览器选区，编辑器持有已经冻结的引用。 */
  const sync_selection = useEffectEvent((): void => {
    if (props.disabled || selecting_ref.current || selection?.mode === "editing") return;
    const target = read_selection(root_ref.current);
    set_selection(target === null ? null : { ...target, mode: "action" });
  });
  /** Tab 进入批注操作，Escape 返回正文，扩选继续使用浏览器键盘行为。 */
  const handle_key_down = useEffectEvent((event: KeyboardEvent): void => {
    if (selection === null || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    } else if (
      event.key === "Tab" &&
      !event.shiftKey &&
      selection.mode === "action" &&
      !(event.target instanceof Node && refs.floating.current?.contains(event.target)) &&
      !(
        event.target instanceof Element &&
        event.target.closest('input, textarea, [contenteditable="true"]')
      )
    ) {
      event.preventDefault();
      action_ref.current?.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    if (props.disabled) {
      close();
      return;
    }
    /** 合并本帧内的选区和正文更新，在浏览器完成交互后读取。 */
    const schedule = (): void => {
      if (frame_ref.current !== null) return;
      frame_ref.current = requestAnimationFrame(() => {
        frame_ref.current = null;
        sync_selection();
      });
    };
    /** 新选择保留原生选区，让双击和 Shift+点击沿用浏览器语义。 */
    const pointer_down = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || refs.floating.current?.contains(event.target)) return;
      if (
        event.button === 0 &&
        root_ref.current?.contains(event.target) &&
        !(event.target instanceof Element && event.target.closest(EXCLUDED))
      ) {
        cancel_frame();
        selecting_ref.current = true;
        set_selection(null);
      } else close();
    };
    /** 在文档范围结束拖选，接住消息容器外的松手。 */
    const pointer_up = (): void => {
      if (!selecting_ref.current) return;
      selecting_ref.current = false;
      schedule();
    };
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", pointer_down, true);
    document.addEventListener("pointerup", pointer_up, true);
    document.addEventListener("pointercancel", close, true);
    document.addEventListener("keydown", handle_key_down);
    window.addEventListener("blur", close);
    // 流式渲染可能替换文本节点；只观察消息树，浮层自身不会触发同步循环。
    const observer = new MutationObserver(schedule);
    if (root_ref.current)
      observer.observe(root_ref.current, { childList: true, characterData: true, subtree: true });
    return () => {
      cancel_frame();
      selecting_ref.current = false;
      observer.disconnect();
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", pointer_down, true);
      document.removeEventListener("pointerup", pointer_up, true);
      document.removeEventListener("pointercancel", close, true);
      document.removeEventListener("keydown", handle_key_down);
      window.removeEventListener("blur", close);
    };
  }, [props.disabled, refs.floating, cancel_frame, close]);

  /** 冻结文字与锚点几何，让流式 DOM 更新期间的编辑面板保持稳定。 */
  const edit = (): void => {
    if (selection?.mode !== "action") return;
    cancel_frame();
    const rect = selection.anchor.getBoundingClientRect();
    const rects = selection.anchor.getClientRects();
    set_selection({
      ...selection,
      mode: "editing",
      comment: "",
      anchor: {
        getBoundingClientRect: () => rect,
        getClientRects: () => rects,
        contextElement: selection.message,
      },
    });
  };
  /** 将确认后的选文和评论交给消息草稿，再关闭临时界面。 */
  const submit = (): void => {
    if (selection?.mode !== "editing") return;
    props.on_add({
      kind: "response_annotation",
      selectedText: selection.selectedText,
      comment: selection.comment.trim(),
    });
    dismiss();
  };

  return (
    <>
      <div ref={root_ref} className="agent-page__messages">
        {props.children}
      </div>
      {selection === null
        ? null
        : createPortal(
            <div
              ref={refs.setFloating}
              className={`isolate z-(--ui-layer-popover)${selection.mode === "action" ? " agent-response-annotation-popover" : ""}`}
              style={floatingStyles}
              role={selection.mode === "action" ? "toolbar" : undefined}
              aria-label={selection.mode === "action" ? t("agent_page.annotation.add") : undefined}
            >
              {selection.mode === "editing" ? (
                <AgentResponseAnnotationEditor
                  aria-label={t("agent_page.annotation.add")}
                  selected_text={selection.selectedText}
                  comment={selection.comment}
                  on_comment_change={(comment) =>
                    set_selection((current) =>
                      current?.mode === "editing" ? { ...current, comment } : current,
                    )
                  }
                  on_submit={submit}
                  on_cancel={dismiss}
                />
              ) : (
                <AppButton
                  ref={action_ref}
                  type="button"
                  variant="ghost"
                  className="rounded-[inherit] text-[12px] [&_svg]:text-primary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={edit}
                >
                  <MessageSquareQuote aria-hidden="true" />
                  {t("agent_page.annotation.add")}
                </AppButton>
              )}
            </div>,
            document.body,
          )}
    </>
  );
}

/** 按实际选中文字确定消息归属，允许父元素端点及跨正文块，拒绝混入非正文。 */
function read_selection(root: HTMLElement | null): AnnotationTarget | null {
  const native = window.getSelection();
  if (!root || !native || native.isCollapsed || native.rangeCount !== 1) return null;
  const text = native.toString().trim();
  if (text === "") return null;
  const range = native.getRangeAt(0);
  // Range 的端点可以是父元素，逐个检查实际覆盖的文字来确定回复归属。
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let node: Node | null =
    walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode();
  let message: HTMLElement | null = null;
  while (node) {
    if (range.intersectsNode(node)) {
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : node.textContent?.length;
      if (node.textContent?.slice(start, end).trim()) {
        const owner = node.parentElement?.closest<HTMLElement>(MESSAGE);
        if (!owner || !root.contains(owner) || (message && message !== owner)) return null;
        message = owner;
      }
    }
    node = walker.nextNode();
  }
  // 排除区即使没有可选文字，也不能被选区跨过。
  if (
    !message ||
    [...message.querySelectorAll(EXCLUDED)].some((element) => range.intersectsNode(element))
  )
    return null;
  const selected_range = range.cloneRange();
  return {
    selectedText: text,
    message,
    anchor: {
      getBoundingClientRect: () => selected_range.getBoundingClientRect(),
      getClientRects: () => selected_range.getClientRects(),
      contextElement: message,
    },
  };
}
