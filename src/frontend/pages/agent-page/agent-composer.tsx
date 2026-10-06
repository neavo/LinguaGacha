import type { AgentApprovalMode } from "@domain/setting";
import type { JSX, Ref, RefObject } from "react";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import type { ModelSelectionInput } from "@shared/model-selection";
import {
  AGENT_INPUT_QUEUE_LIMIT,
  type AgentChatStatus,
  type AgentContextSnapshot,
  type AgentUsageSnapshot,
  type AgentMessageInput,
  type AgentSkillSnapshot,
} from "@shared/agent";
import type { AgentCommand, AgentInputState } from "@frontend/app/session/agent/agent-chat-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import { ShortcutTooltipRow } from "@frontend/widgets/interactions/shortcut-kbd";
import { AgentMessageEditor, type AgentMessageEditorHandle } from "./agent-message-editor";
import { AgentTaskToolbar } from "./agent-task-toolbar";
import type { AgentMentionInstruction } from "./agent-mention";

export type AgentComposerHandle = AgentMessageEditorHandle;
type AgentUnavailableReason = "restoring" | "runtime_busy" | "settling" | "disconnected";
type AgentComposerProps = {
  ref?: Ref<AgentComposerHandle>;
  file_drop_target_ref?: RefObject<HTMLElement | null>;
  locked?: boolean;
  skills: readonly AgentSkillSnapshot[];
  instructions?: readonly AgentMentionInstruction[];
  state: AgentChatStatus; // 同一会话状态决定发送与停止收尾的可用性
  stop_disabled: boolean; // 当前原子阶段只禁用 stop，不锁定草稿编辑
  compacting: boolean;
  unavailable_reason: AgentUnavailableReason | null;
  command: AgentCommand;
  can_continue_queue: boolean;
  queue_full: boolean;
  can_reset: boolean;
  context: AgentContextSnapshot;
  usage: AgentUsageSnapshot;
  approval_mode: AgentApprovalMode;
  approval_disabled: boolean;
  model_selection: ModelSelectionController;
  input_state: AgentInputState;
  on_send: (message: AgentMessageInput) => void;
  on_agent_model_select: (change: ModelSelectionInput) => void;
  on_approval_mode_change: (approval_mode: AgentApprovalMode) => void;
  on_stop: () => Promise<void>;
  on_reset: () => void;
};

/** 命令不可用原因同时驱动禁用态和提示，禁止平行布尔量产生矛盾组合。 */
const AGENT_UNAVAILABLE_REASON_KEYS = Object.freeze({
  restoring: "agent_page.unavailable.restoring",
  disconnected: "agent_page.error.connection",
  runtime_busy: "agent_page.unavailable.runtime_busy",
  settling: "agent_page.unavailable.settling",
} satisfies Readonly<Record<AgentUnavailableReason, LocaleKey>>);

/** 主输入只组合编辑器与任务操作；运行态不锁定模型设置和导出。 */
export function AgentComposer(props: AgentComposerProps): JSX.Element {
  const { t } = useI18n();
  const locked = props.locked === true;
  const compacting = props.compacting;
  const running = props.state !== "idle";
  const stopping = props.state === "stopping";
  const unavailable_reason = stopping ? "settling" : props.unavailable_reason;
  const editor_read_only =
    locked || ["send", "continue", "revise", "queue_update", "reset"].includes(props.command ?? "");
  const submit_command_active = ["send", "continue", "revise", "queue_update", "stop"].includes(
    props.command ?? "",
  );
  return (
    <AgentMessageEditor
      ref={props.ref}
      file_drop_target_ref={props.file_drop_target_ref}
      read_only={editor_read_only}
      skills={props.skills}
      instructions={props.instructions}
      input_state={props.input_state}
      on_submit={props.on_send}
      render_actions={({ has_content, uploads_pending }) => {
        const continuing_queue = props.can_continue_queue && !running && !locked;
        // 主按钮只表达稳定动作：运行中有内容发送、空内容停止，暂停队列统一继续。
        const stop_action = running && !has_content && !locked;
        // 满队列只阻止会新增输入的动作；停止、保存和编辑不受容量提示影响。
        const queue_full_for_submit =
          props.queue_full && has_content && ((running && !locked) || continuing_queue);
        let submit_label_key: LocaleKey = "agent_page.action.send";
        const can_submit =
          !locked &&
          unavailable_reason === null &&
          props.command === null &&
          !uploads_pending &&
          (has_content || continuing_queue) &&
          !queue_full_for_submit;
        const can_stop = !stopping && !props.stop_disabled && props.command === null;
        if (queue_full_for_submit) submit_label_key = "agent_page.queue.full";
        else if (continuing_queue) submit_label_key = "agent_page.action.continue";
        else if (stopping) submit_label_key = "agent_page.unavailable.settling";
        else if (running && has_content) submit_label_key = "agent_page.action.send";
        else if (compacting) submit_label_key = "agent_page.compaction.running";
        else if (running && props.stop_disabled) submit_label_key = "agent_page.action.applying";
        else if (stop_action) submit_label_key = "agent_page.action.stop";
        const contextual_submit_label = queue_full_for_submit
          ? t("agent_page.queue.full", {
              count: AGENT_INPUT_QUEUE_LIMIT.toString(),
              limit: AGENT_INPUT_QUEUE_LIMIT.toString(),
            })
          : t(submit_label_key);

        return {
          can_submit,
          actions: (
            <AgentTaskToolbar
              locked={locked}
              can_reset={
                props.can_reset &&
                !locked &&
                !running &&
                unavailable_reason === null &&
                props.command === null
              }
              context={props.context}
              usage={props.usage}
              model_selection={props.model_selection}
              approval_mode={props.approval_mode}
              approval_disabled={props.approval_disabled}
              disconnected={unavailable_reason === "disconnected"}
              on_reset={props.on_reset}
              on_agent_model_select={props.on_agent_model_select}
              on_approval_mode_change={props.on_approval_mode_change}
            />
          ),
          submit: (
            <Tooltip>
              {/* 外层触发器在按钮禁用 pointer events 时仍可承接悬停。 */}
              <TooltipTrigger
                render={
                  <span className="agent-composer__submit-shell">
                    <AppButton
                      className="agent-composer__submit"
                      type={stop_action ? "button" : "submit"}
                      size="icon-sm"
                      onClick={stop_action ? () => void props.on_stop() : undefined}
                      disabled={stop_action ? !can_stop : !can_submit}
                      aria-label={contextual_submit_label}
                      aria-busy={submit_command_active || undefined}
                      aria-keyshortcuts={can_submit ? "Enter" : undefined}
                    >
                      {stopping || (compacting && stop_action) || submit_command_active ? (
                        <LoaderCircle className="animate-spin" aria-hidden="true" />
                      ) : stop_action ? (
                        <Square aria-hidden="true" />
                      ) : (
                        <ArrowUp aria-hidden="true" />
                      )}
                    </AppButton>
                  </span>
                }
              />
              {submit_command_active ? null : (
                <TooltipContent className="flex-col items-stretch gap-1 whitespace-nowrap">
                  {unavailable_reason !== null ? (
                    <p>{t(AGENT_UNAVAILABLE_REASON_KEYS[unavailable_reason])}</p>
                  ) : stop_action || queue_full_for_submit ? (
                    <p>{contextual_submit_label}</p>
                  ) : (
                    <>
                      <ShortcutTooltipRow label={contextual_submit_label} shortcut="submit" />
                      {!editor_read_only ? (
                        <ShortcutTooltipRow
                          label={t("agent_page.input.newline")}
                          shortcut="newline"
                        />
                      ) : null}
                    </>
                  )}
                </TooltipContent>
              )}
            </Tooltip>
          ),
        };
      }}
    />
  );
}
