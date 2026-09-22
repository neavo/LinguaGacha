import type { ComponentProps } from "react";
import { X } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-context";
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
                <ShortcutKbd action="submit" className="bg-background/18 text-primary-foreground" />
              </AppButton>
            }
          />
          <TooltipContent>
            <ShortcutTooltipRow label={t("agent_page.input.newline")} shortcut="newline" />
          </TooltipContent>
        </Tooltip>
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
