import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MessageSquareQuote, X } from "lucide-react";
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
import { useI18n } from "@frontend/app/locale/locale-provider";
import { cn } from "@frontend/shadcn/classnames";
import { Textarea } from "@frontend/shadcn/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import { ShortcutKbd, ShortcutTooltipRow } from "@frontend/widgets/interactions/shortcut-kbd";

type AgentResponseAnnotationEditorProps = Omit<ComponentProps<"div">, "aria-label" | "onSubmit"> & {
  "aria-label": string;
  selected_text: string;
  comment: string;
  on_comment_change: (comment: string) => void;
  on_submit: () => void;
  on_cancel: () => void;
  on_remove?: () => void;
};

type AgentResponseAnnotationPanelProps = Omit<ComponentProps<"div">, "aria-label"> & {
  "aria-label": string;
  selected_text: string;
  on_cancel?: () => void;
};

/** 批注创建、草稿编辑与已发送只读态共用同一个视觉表面。 */
function AgentResponseAnnotationPanel({
  className,
  selected_text,
  on_cancel,
  children,
  ...container_props
}: AgentResponseAnnotationPanelProps): JSX.Element {
  const { t } = useI18n();

  return (
    <div {...container_props} className={cn("agent-annotation-panel", className)} role="dialog">
      <div className="agent-annotation-panel__header">
        <strong>{t("agent_page.annotation.selected_text")}</strong>
        {on_cancel === undefined ? null : (
          <AppButton
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t("app.action.close")}
            onClick={on_cancel}
          >
            <X aria-hidden="true" />
          </AppButton>
        )}
      </div>
      <blockquote>{selected_text}</blockquote>
      {children}
    </div>
  );
}

/** 选择浮层与 Composer 共用的唯一批注编辑器；输入外观统一交给 Textarea 基元。 */
export function AgentResponseAnnotationEditor({
  comment,
  on_comment_change,
  on_submit,
  on_cancel,
  on_remove,
  ...panel_props
}: AgentResponseAnnotationEditorProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AgentResponseAnnotationPanel {...panel_props}>
      <label>
        <span>{t("agent_page.annotation.user_comment")}</span>
        <Textarea
          autoFocus
          className="agent-annotation-editor__comment"
          value={comment}
          placeholder={t("agent_page.annotation.comment_placeholder")}
          onChange={(event) => on_comment_change(event.currentTarget.value)}
          onKeyDown={(event) => {
            // 输入法候选优先；Enter 保存，Shift+Enter 保留 Textarea 原生换行。
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              on_cancel();
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              on_submit();
            }
          }}
        />
      </label>
      <div className="agent-annotation-editor__actions">
        {on_remove === undefined ? null : (
          <AppButton type="button" size="sm" variant="destructive" onClick={on_remove}>
            {t("agent_page.annotation.remove")}
          </AppButton>
        )}
        <div className="agent-annotation-editor__commit-actions">
          <AppButton
            type="button"
            size="sm"
            variant="outline"
            aria-label={t("app.action.cancel")}
            aria-keyshortcuts="Escape"
            onClick={on_cancel}
          >
            {t("app.action.cancel")}
            <ShortcutKbd action="cancel" />
          </AppButton>
          <Tooltip>
            <TooltipTrigger
              render={
                <AppButton
                  type="button"
                  size="sm"
                  aria-label={t("app.action.save")}
                  aria-keyshortcuts="Enter"
                  onClick={on_submit}
                >
                  {t("app.action.save")}
                  <ShortcutKbd
                    action="submit"
                    className="bg-background/18 text-primary-foreground"
                  />
                </AppButton>
              }
            />
            <TooltipContent side="top" sideOffset={8}>
              <ShortcutTooltipRow label={t("agent_page.input.newline")} shortcut="newline" />
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </AgentResponseAnnotationPanel>
  );
}

type AgentResponseAnnotationViewerProps = Omit<AgentResponseAnnotationPanelProps, "on_cancel"> & {
  comment: string;
  on_cancel: () => void;
};

/** 已发送批注只移除编辑动作，保留与草稿一致的内容层级和锚定表面。 */
export function AgentResponseAnnotationViewer({
  comment,
  ...panel_props
}: AgentResponseAnnotationViewerProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AgentResponseAnnotationPanel {...panel_props}>
      {comment === "" ? null : (
        <section className="agent-annotation-panel__comment-section">
          <strong>{t("agent_page.annotation.user_comment")}</strong>
          <p className="agent-annotation-panel__comment">{comment}</p>
        </section>
      )}
    </AgentResponseAnnotationPanel>
  );
}

type AnnotationSelection =
  | {
      mode: "action";
      selectedText: string;
      anchor: VirtualElement;
      focus_action: boolean; // 键盘创建的选区把焦点交给批注动作，指针选区保留原焦点。
    }
  | {
      mode: "editing";
      selectedText: string;
      anchor: VirtualElement;
      comment: string;
    };

type AgentResponseAnnotationSelectionProps = {
  children: ReactNode;
  disabled: boolean;
  on_add: (annotation: AgentResponseAnnotationAttachment) => void;
};

/** 只在已标记的最终回复正文内读取原生选区，并拥有唯一的临时批注浮动工具。 */
export function AgentResponseAnnotationSelection(
  props: AgentResponseAnnotationSelectionProps,
): JSX.Element {
  const { t } = useI18n();
  const root_ref = useRef<HTMLDivElement | null>(null);
  const action_ref = useRef<HTMLButtonElement | null>(null);
  const [selection, set_selection] = useState<AnnotationSelection | null>(null);
  // 多行 Range 直接作为 fixed 虚拟锚点；定位层跟随滚动和布局变化，不复制坐标状态。
  const { refs, floatingStyles } = useFloating({
    open: selection !== null,
    elements: { reference: selection?.anchor ?? null },
    placement: "top",
    strategy: "fixed",
    middleware: [inline(), offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  // Effect 只订阅语义开关，编辑评论时不反复解绑全局交互监听。
  const selection_open = selection !== null;
  const focus_action = selection?.mode === "action" && selection.focus_action;

  useEffect(() => {
    if (props.disabled) set_selection(null);
  }, [props.disabled]);

  /** 键盘选区公开可达操作，指针选区继续保留正文焦点与复制语义。 */
  useEffect(() => {
    if (focus_action) action_ref.current?.focus();
  }, [focus_action]);

  /** 浮动工具只在正文、工具自身与 Escape 之外的交互中关闭。 */
  useEffect(() => {
    if (!selection_open) return;
    const handle_pointer_down = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        (root_ref.current?.contains(target) || refs.floating.current?.contains(target))
      ) {
        return;
      }
      set_selection(null);
    };
    const handle_key_down = (event: KeyboardEvent): void => {
      if (event.key === "Escape") set_selection(null);
    };
    document.addEventListener("pointerdown", handle_pointer_down);
    document.addEventListener("keydown", handle_key_down);
    return () => {
      document.removeEventListener("pointerdown", handle_pointer_down);
      document.removeEventListener("keydown", handle_key_down);
    };
  }, [refs.floating, selection_open]);

  /** 原生选区必须完整落在同一个最终回复正文内，避免跨工具或消息构造伪引用。 */
  const read_selection = (focus_action: boolean): void => {
    if (props.disabled) return;
    const native_selection = window.getSelection();
    const root = root_ref.current;
    if (
      native_selection === null ||
      native_selection.isCollapsed ||
      native_selection.rangeCount === 0
    ) {
      set_selection(null);
      return;
    }
    const range = native_selection.getRangeAt(0);
    const start_surface = find_annotation_surface(range.startContainer);
    const end_surface = find_annotation_surface(range.endContainer);
    const selected_text = native_selection.toString().trim();
    if (
      root === null ||
      start_surface === null ||
      start_surface !== end_surface ||
      !root.contains(start_surface) ||
      selected_text === ""
    ) {
      set_selection(null);
      return;
    }
    const selected_range = range.cloneRange();
    const anchor: VirtualElement = {
      getBoundingClientRect: () => selected_range.getBoundingClientRect(),
      getClientRects: () => selected_range.getClientRects(),
      contextElement: start_surface,
    };
    set_selection({
      selectedText: selected_text,
      anchor,
      mode: "action",
      focus_action,
    });
  };

  /** 提交后同时清理临时 UI 与浏览器选区，已确认内容只由消息草稿继续持有。 */
  const submit = (): void => {
    if (selection?.mode !== "editing") return;
    props.on_add({
      kind: "response_annotation",
      selectedText: selection.selectedText,
      comment: selection.comment.trim(),
    });
    set_selection(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <>
      <div
        ref={root_ref}
        className="agent-page__messages"
        onPointerUp={() => read_selection(false)}
        onKeyUp={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.shiftKey) read_selection(true);
        }}
      >
        {props.children}
      </div>
      {selection === null
        ? null
        : createPortal(
            <div
              ref={refs.setFloating}
              className={`isolate z-(--ui-layer-popover)${
                selection.mode === "action" ? " agent-response-annotation-popover" : ""
              }`}
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
                    set_selection((current) => (current === null ? null : { ...current, comment }))
                  }
                  on_submit={submit}
                  on_cancel={() => set_selection(null)}
                />
              ) : (
                <AppButton
                  ref={action_ref}
                  type="button"
                  variant="ghost"
                  className="rounded-[inherit] text-[12px] [&_svg]:text-primary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    set_selection((current) =>
                      current?.mode !== "action"
                        ? current
                        : {
                            mode: "editing",
                            selectedText: current.selectedText,
                            anchor: current.anchor,
                            comment: "",
                          },
                    )
                  }
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

/** 从 Range 边界回溯其所属的可批注助手正文。 */
function find_annotation_surface(node: Node): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest<HTMLElement>('[data-agent-annotation-content="true"]') ?? null;
}
