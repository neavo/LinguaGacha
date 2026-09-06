import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type AgentMessageInput, type AgentSkillSnapshot } from "@shared/agent";
import type {
  AgentCommand,
  AgentInputSession,
} from "@frontend/app/session/agent/agent-session-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { AgentMessageEditor, type AgentMessageEditorHandle } from "./agent-message-editor";
import { AppButton } from "@frontend/widgets/app-button";
import { LoaderCircle } from "lucide-react";
import { ShortcutKbd, ShortcutTooltipRow } from "@frontend/widgets/interactions/shortcut-kbd";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  tooltip_trigger_target,
} from "@frontend/shadcn/tooltip";

export type AgentInlineEditTarget =
  | {
      kind: "entry";
      entryId: string;
      role: "user" | "assistant";
      message: AgentMessageInput;
    }
  | {
      kind: "queue";
      itemId: string;
      message: AgentMessageInput;
    };

type AgentInlineEditorProps = {
  target: AgentInlineEditTarget;
  skills: readonly AgentSkillSnapshot[];
  command: AgentCommand;
  unavailable_reason: "restoring" | "runtime_busy" | "settling" | "disconnected" | null;
  on_save: (message: AgentMessageInput) => Promise<void>;
  on_saved: (message: AgentMessageInput) => void;
  on_cancel: () => void;
  on_image_error: () => void;
};

const EMPTY_INPUT_HISTORY: readonly string[] = [];

/**
 * 历史与队列编辑共用输入能力，但拥有独立草稿；普通 Composer 永远不会被改写。
 */
export function AgentInlineEditor(props: AgentInlineEditorProps): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const composer_ref = useRef<AgentMessageEditorHandle | null>(null);
  const draft_ref = useRef<AgentMessageInput>(structuredClone(props.target.message));
  // 保存只锁定当前编辑器，普通 Composer 和 Agent session 不参与这段瞬时状态。
  const [status, set_status] = useState<"idle" | "saving">("idle");

  const read_draft = useCallback((): AgentMessageInput => draft_ref.current, []);
  const write_draft = useCallback((message: AgentMessageInput): void => {
    draft_ref.current = structuredClone(message);
  }, []);
  /** 保存期间禁止取消，失败后仍保留可编辑草稿。 */
  const cancel_edit = useCallback((): void => {
    if (status === "saving") return;
    props.on_cancel();
  }, [props.on_cancel, status]);
  const input_session = useMemo<AgentInputSession>(
    () => ({
      revision: 0,
      read_draft,
      write_draft,
      read_history: () => EMPTY_INPUT_HISTORY,
      replace_history: () => undefined,
    }),
    [read_draft, write_draft],
  );

  useEffect(() => {
    composer_ref.current?.focus();
  }, []);

  const error_key: LocaleKey =
    props.target.kind === "queue" ? "agent_page.error.queue_update" : "agent_page.error.edit";

  const save = useCallback(
    async (message: AgentMessageInput): Promise<void> => {
      // 受理失败不关闭编辑器，确保用户可以直接修正并再次提交原草稿。
      set_status("saving");
      try {
        await props.on_save(message);
        props.on_saved(message);
      } catch (caught_error) {
        push_toast("error", resolve_visible_error_message(caught_error, t, t(error_key)));
        set_status("idle");
      }
    },
    [error_key, props.on_save, props.on_saved, push_toast, t],
  );

  const submit = useCallback(
    (message: AgentMessageInput): void => {
      if (status !== "idle") return;
      void save(message);
    },
    [save, status],
  );

  const read_only = status !== "idle" || props.command !== null;
  const title_key: LocaleKey =
    props.target.kind === "queue"
      ? "agent_page.editing.queue"
      : props.target.role === "assistant"
        ? "agent_page.editing.assistant"
        : "agent_page.editing.user";

  return (
    <div
      className="agent-inline-editor"
      data-role={props.target.kind === "queue" ? "queue" : props.target.role}
    >
      <div className="agent-inline-editor__title">{t(title_key)}</div>
      <AgentMessageEditor
        ref={composer_ref}
        presentation="inline"
        role={props.target.kind === "queue" ? "user" : props.target.role}
        on_cancel={cancel_edit}
        read_only={read_only}
        skills={props.skills}
        input_session={input_session}
        on_submit={submit}
        on_image_error={props.on_image_error}
        render_actions={({ has_content, image_processing }) => {
          const can_submit =
            !read_only && props.unavailable_reason === null && has_content && !image_processing;
          return {
            can_submit,
            submit: (
              <>
                <AppButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={read_only}
                  aria-label={t("app.action.cancel")}
                  aria-keyshortcuts={read_only ? undefined : "Escape"}
                  onClick={cancel_edit}
                >
                  {t("app.action.cancel")}
                  <ShortcutKbd action="cancel" />
                </AppButton>
                <Tooltip>
                  <TooltipTrigger
                    render={tooltip_trigger_target(
                      <AppButton
                        className="agent-composer__inline-submit"
                        type="submit"
                        size="sm"
                        disabled={!can_submit}
                        aria-label={t("app.action.save")}
                        aria-busy={status === "saving" || undefined}
                        aria-keyshortcuts={can_submit ? "Enter" : undefined}
                      >
                        {status === "saving" ? (
                          <LoaderCircle className="animate-spin" aria-hidden="true" />
                        ) : null}
                        <span>{t("app.action.save")}</span>
                        {can_submit ? (
                          <ShortcutKbd
                            action="submit"
                            className="bg-background/18 text-primary-foreground"
                          />
                        ) : null}
                      </AppButton>,
                    )}
                  />
                  <TooltipContent side="top" sideOffset={8}>
                    <ShortcutTooltipRow label={t("agent_page.input.newline")} shortcut="newline" />
                  </TooltipContent>
                </Tooltip>
              </>
            ),
          };
        }}
      />
    </div>
  );
}
