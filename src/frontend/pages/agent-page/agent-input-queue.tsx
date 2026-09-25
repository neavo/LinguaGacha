import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  SORTABLE_OPTIONS,
  SORTABLE_PROVIDER_OPTIONS,
} from "@frontend/widgets/interactions/sortable";
import { useReorder } from "@frontend/widgets/interactions/use-reorder";
import { GripVertical, LoaderCircle, Pencil, Send, Trash2 } from "lucide-react";
import type { JSX, ReactNode } from "react";

import { useI18n } from "@frontend/app/locale/locale-context";
import type { AgentInputQueueSnapshot, AgentQueuedInput } from "@shared/agent";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipTarget } from "@frontend/shadcn/tooltip";

type AgentInputQueueProps = {
  queue: AgentInputQueueSnapshot;
  disabled: boolean;
  active_edit_item_id?: string | null;
  render_item_editor?: (item: AgentQueuedInput) => ReactNode | null;
  on_edit: (item: AgentQueuedInput) => void;
  on_delete: (id: string) => void;
  on_reorder: (ids: readonly string[]) => Promise<void>;
  on_send_now: (id: string) => void;
};

/** 当前会话输入队列；顺序、状态和能力全部来自后端快照。 */
export function AgentInputQueue(props: AgentInputQueueProps): JSX.Element | null {
  const editing = props.active_edit_item_id != null;
  const reorder = useReorder({
    ids: props.queue.items.map((item) => item.id),
    disabled: props.disabled || editing,
    disabled_ids: props.queue.items
      .filter((item) => item.status === "sending")
      .map((item) => item.id),
    on_reorder: props.on_reorder,
  });
  if (props.queue.items.length === 0) return null;
  const items_by_id = new Map(props.queue.items.map((item) => [item.id, item]));

  return (
    <div className="agent-input-queue">
      <DragDropProvider {...SORTABLE_PROVIDER_OPTIONS} {...reorder.events}>
        <ol className="agent-input-queue__items">
          {reorder.ordered_ids.map((id, index) => {
            const item = items_by_id.get(id)!;
            return (
              <AgentInputQueueItem
                key={item.id}
                item={item}
                index={index}
                disabled={props.disabled || editing || reorder.pending}
                can_send_now={props.queue.canSendNow}
                editing={props.active_edit_item_id === item.id}
                render_editor={props.render_item_editor}
                on_edit={props.on_edit}
                on_delete={props.on_delete}
                on_send_now={props.on_send_now}
              />
            );
          })}
        </ol>
      </DragDropProvider>
    </div>
  );
}

/** 单行根据 queued / sending 状态收口可用操作，不维护第二份本地状态。 */
function AgentInputQueueItem(props: {
  item: AgentQueuedInput;
  index: number;
  disabled: boolean;
  can_send_now: boolean;
  editing: boolean;
  render_editor?: ((item: AgentQueuedInput) => ReactNode | null) | undefined;
  on_edit: (item: AgentQueuedInput) => void;
  on_delete: (id: string) => void;
  on_send_now: (id: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  // sending 只替换主操作内容；所有可变操作共用同一禁用事实。
  const sending = props.item.status === "sending";
  // 编辑目标原位替换整行，避免第二个 Composer 继续占用队列操作位。
  const editor = props.editing ? (props.render_editor?.(props.item) ?? null) : null;
  const item_actions_disabled = props.disabled || sending || editor !== null;
  const sortable = useSortable({
    ...SORTABLE_OPTIONS,
    index: props.index,
    id: props.item.id,
    disabled: item_actions_disabled,
  });
  if (editor !== null) {
    return (
      <li ref={sortable.ref} className="agent-input-queue__item agent-input-queue__item--editing">
        {editor}
      </li>
    );
  }
  const attachment_count = props.item.attachments.length;
  const preview = props.item.text || t("agent_page.queue.no_message_text");
  return (
    <li ref={sortable.ref} className="agent-input-queue__item">
      <Tooltip>
        <TooltipTrigger
          render={
            <TooltipTarget>
              <AppButton
                type="button"
                size="icon-xs"
                variant="ghost"
                className="agent-input-queue__drag"
                disabled={item_actions_disabled}
                aria-label={t("agent_page.queue.reorder")}
                ref={sortable.handleRef}
              >
                <GripVertical aria-hidden="true" />
              </AppButton>
            </TooltipTarget>
          }
        />
        <TooltipContent side="top">
          <p>{t("agent_page.queue.reorder")}</p>
        </TooltipContent>
      </Tooltip>
      <span className="agent-input-queue__preview">{preview}</span>
      {attachment_count > 0 ? (
        <span className="agent-input-queue__attachments">
          {t("agent_page.queue.attachments", { count: attachment_count.toString() })}
        </span>
      ) : null}
      <div className="agent-input-queue__actions">
        <QueueIconAction
          label={t(sending ? "agent_page.queue.sending" : "agent_page.queue.send_now")}
          disabled={item_actions_disabled || !props.can_send_now}
          busy={sending}
          on_click={() => props.on_send_now(props.item.id)}
        >
          {sending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
        </QueueIconAction>
        <QueueIconAction
          label={t("agent_page.action.edit")}
          disabled={item_actions_disabled}
          on_click={() => props.on_edit(props.item)}
        >
          <Pencil aria-hidden="true" />
        </QueueIconAction>
        <QueueIconAction
          label={t("agent_page.queue.delete")}
          disabled={item_actions_disabled}
          on_click={() => props.on_delete(props.item.id)}
        >
          <Trash2 aria-hidden="true" />
        </QueueIconAction>
      </div>
    </li>
  );
}

/** 图标操作统一可访问名称与鼠标说明，避免各行复制 Tooltip 结构。 */
function QueueIconAction(props: {
  label: string;
  disabled: boolean;
  busy?: boolean; // 同时驱动运行态公告和禁用态视觉
  on_click: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TooltipTarget>
            <AppButton
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={props.disabled}
              aria-label={props.label}
              aria-busy={props.busy || undefined}
              aria-live={props.busy ? "polite" : undefined}
              className={props.busy ? "disabled:opacity-100" : undefined}
              onClick={props.on_click}
            >
              {props.children}
            </AppButton>
          </TooltipTarget>
        }
      />
      <TooltipContent side="top">
        <p>{props.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
