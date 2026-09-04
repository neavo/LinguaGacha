import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type AgentMessageInput, type AgentSkillSnapshot } from "@shared/agent";
import type {
  AgentCommand,
  AgentInputSession,
} from "@frontend/app/session/agent/agent-session-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import { AgentComposer, type AgentComposerHandle } from "./agent-composer";

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
  model_selection: ModelSelectionController;
  unavailable_reason: "restoring" | "runtime_busy" | "settling" | null;
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
  const composer_ref = useRef<AgentComposerHandle | null>(null);
  const draft_ref = useRef<AgentMessageInput>(structuredClone(props.target.message));
  // 保存只锁定当前编辑器，普通 Composer 和 Agent session 不参与这段瞬时状态。
  const [status, set_status] = useState<"idle" | "saving">("idle");
  const [error, set_error] = useState<string | null>(null);

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
      set_error(null);
      try {
        await props.on_save(message);
        props.on_saved(message);
      } catch (caught_error) {
        set_error(resolve_visible_error_message(caught_error, t, t(error_key)));
        set_status("idle");
      }
    },
    [error_key, props.on_save, props.on_saved, t],
  );

  const submit = useCallback(
    (message: AgentMessageInput): void => {
      if (status !== "idle") return;
      set_error(null);
      void save(message);
    },
    [save, status],
  );

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
      <AgentComposer
        ref={composer_ref}
        presentation="inline"
        inline_role={props.target.kind === "queue" ? "user" : props.target.role}
        on_cancel_edit={cancel_edit}
        locked={status !== "idle"}
        skills={props.skills}
        running={false}
        stop_disabled
        compacting={false}
        unavailable_reason={props.unavailable_reason}
        command={props.command}
        can_continue_queue={false}
        queue_full={false}
        can_reset={false}
        context_tokens={null}
        model_selection={props.model_selection}
        input_session={input_session}
        on_send={submit}
        on_image_error={props.on_image_error}
        on_stop={async () => undefined}
        on_reset={() => undefined}
      />
      {error === null ? null : (
        <p className="agent-inline-editor__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
