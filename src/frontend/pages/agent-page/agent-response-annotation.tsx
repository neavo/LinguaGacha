import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, MessageSquareQuote, Trash2, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import type { AgentResponseAnnotationAttachment } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { cn } from "@frontend/shadcn/classnames";
import { Textarea } from "@frontend/shadcn/textarea";
import { AppButton } from "@frontend/widgets/app-button";

type AgentResponseAnnotationEditorProps = Omit<ComponentProps<"div">, "aria-label" | "onSubmit"> & {
  "aria-label": string;
  selected_text: string;
  comment: string;
  submit_label: string;
  on_comment_change: (comment: string) => void;
  on_submit: () => void;
  on_cancel: () => void;
  on_remove?: () => void;
};

type AgentResponseAnnotationPanelProps = Omit<ComponentProps<"div">, "aria-label"> & {
  "aria-label": string;
  selected_text: string;
  on_cancel: () => void;
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
        <AppButton
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={t("app.action.close")}
          onClick={on_cancel}
        >
          <X aria-hidden="true" />
        </AppButton>
      </div>
      <blockquote>{selected_text}</blockquote>
      {children}
    </div>
  );
}

/** 选择浮层与 Composer 共用的唯一批注编辑器；输入外观统一交给 Textarea 基元。 */
export function AgentResponseAnnotationEditor({
  comment,
  submit_label,
  on_comment_change,
  on_submit,
  on_cancel,
  on_remove,
  ...panel_props
}: AgentResponseAnnotationEditorProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AgentResponseAnnotationPanel {...panel_props} on_cancel={on_cancel}>
      <label>
        <span>{t("agent_page.annotation.user_comment")}</span>
        <Textarea
          autoFocus
          className="agent-annotation-editor__comment"
          value={comment}
          placeholder={t("agent_page.annotation.comment_placeholder")}
          onChange={(event) => on_comment_change(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") on_cancel();
            else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              on_submit();
            }
          }}
        />
      </label>
      <div className="agent-annotation-editor__actions">
        {on_remove === undefined ? null : (
          <AppButton type="button" size="xs" variant="destructive" onClick={on_remove}>
            <Trash2 aria-hidden="true" />
            {t("agent_page.annotation.remove")}
          </AppButton>
        )}
        <AppButton type="button" size="xs" onClick={on_submit}>
          <Check aria-hidden="true" />
          {submit_label}
        </AppButton>
      </div>
    </AgentResponseAnnotationPanel>
  );
}

type AgentResponseAnnotationViewerProps = AgentResponseAnnotationPanelProps & {
  comment: string;
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

type AnnotationSelection = {
  selectedText: string;
  comment: string;
  editing: boolean;
  focus_action: boolean; // 键盘创建的选区把焦点交给批注动作，指针选区保留原焦点。
};

type AgentResponseAnnotationSelectionProps = {
  children: ReactNode;
  disabled: boolean;
  on_add: (annotation: AgentResponseAnnotationAttachment) => void;
};

/** 只在已标记的最终回复正文内读取原生选区，并拥有唯一的临时批注浮层。 */
export function AgentResponseAnnotationSelection(
  props: AgentResponseAnnotationSelectionProps,
): JSX.Element {
  const { t } = useI18n();
  const root_ref = useRef<HTMLDivElement | null>(null);
  // Range 是批注浮层唯一锚点；Radix 直接读取其视口矩形，滚动与碰撞无需第二套坐标状态。
  const anchor_ref = useRef<{ getBoundingClientRect: () => DOMRect } | null>(null);
  const action_ref = useRef<HTMLButtonElement | null>(null);
  const [selection, set_selection] = useState<AnnotationSelection | null>(null);

  useEffect(() => {
    if (props.disabled) set_selection(null);
  }, [props.disabled]);

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
    anchor_ref.current = { getBoundingClientRect: () => selected_range.getBoundingClientRect() };
    set_selection({
      selectedText: selected_text,
      comment: "",
      editing: false,
      focus_action,
    });
  };

  /** 提交后同时清理临时 UI 与浏览器选区，已确认内容只由消息草稿继续持有。 */
  const submit = (): void => {
    if (selection === null) return;
    props.on_add({
      kind: "response_annotation",
      selectedText: selection.selectedText,
      comment: selection.comment.trim(),
    });
    set_selection(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <PopoverPrimitive.Root
      open={selection !== null}
      onOpenChange={(open) => {
        if (!open) set_selection(null);
      }}
    >
      <div
        ref={root_ref}
        className="agent-page__messages"
        onPointerUp={() => read_selection(false)}
        onKeyUp={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.shiftKey) read_selection(true);
        }}
      >
        {props.children}
      </div>
      <PopoverPrimitive.Anchor virtualRef={anchor_ref} />
      {selection === null ? null : (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            asChild
            side="top"
            align="center"
            sideOffset={8}
            collisionPadding={8}
            hideWhenDetached
            updatePositionStrategy="always"
            onPointerDownOutside={(event) => {
              // 正文内的重新选择由 onPointerUp 统一裁决，不能再让 Popover 的延迟关闭覆盖结果。
              const target = event.detail.originalEvent.target;
              if (target instanceof Node && root_ref.current?.contains(target)) {
                event.preventDefault();
              }
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (selection.focus_action) requestAnimationFrame(() => action_ref.current?.focus());
            }}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {selection.editing ? (
              <AgentResponseAnnotationEditor
                className="agent-response-annotation-popover"
                aria-label={t("agent_page.annotation.add")}
                selected_text={selection.selectedText}
                comment={selection.comment}
                submit_label={t("agent_page.annotation.add")}
                on_comment_change={(comment) =>
                  set_selection((current) => (current === null ? null : { ...current, comment }))
                }
                on_submit={submit}
                on_cancel={() => set_selection(null)}
              />
            ) : (
              <div
                className="agent-response-annotation-popover"
                role="toolbar"
                aria-label={t("agent_page.annotation.add")}
              >
                <button
                  ref={action_ref}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    set_selection((current) =>
                      current === null ? null : { ...current, editing: true },
                    )
                  }
                >
                  <MessageSquareQuote aria-hidden="true" />
                  {t("agent_page.annotation.add")}
                </button>
              </div>
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      )}
    </PopoverPrimitive.Root>
  );
}

/** 从 Range 边界回溯其所属的可批注助手正文。 */
function find_annotation_surface(node: Node): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest<HTMLElement>('[data-agent-annotation-content="true"]') ?? null;
}
