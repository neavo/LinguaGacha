import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, LoaderCircle, Pencil, Send, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import type { AgentInputQueueSnapshot, AgentQueuedInput } from "@shared/agent";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type AgentInputQueueProps = {
  queue: AgentInputQueueSnapshot;
  disabled: boolean;
  active_edit_item_id?: string | null;
  render_item_editor?: (item: AgentQueuedInput) => ReactNode | null;
  on_edit: (item: AgentQueuedInput) => void;
  on_delete: (id: string) => void;
  on_reorder: (ids: readonly string[]) => void;
  on_send_now: (id: string) => void;
};

/** 当前会话输入队列；顺序、状态和能力全部来自后端快照。 */
export function AgentInputQueue(props: AgentInputQueueProps): JSX.Element | null {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (props.queue.items.length === 0) return null;

  /** DnD 只提交完整身份顺序，权威排列等待后端快照返回。 */
  const finish_drag = (event: DragEndEvent): void => {
    if (event.over === null || event.active.id === event.over.id) return;
    const ids = props.queue.items.map((item) => item.id);
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from >= 0 && to >= 0) props.on_reorder(arrayMove(ids, from, to));
  };

  return (
    <div className="agent-input-queue">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finish_drag}>
        <SortableContext
          items={props.queue.items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="agent-input-queue__items">
            {props.queue.items.map((item) => (
              <AgentInputQueueItem
                key={item.id}
                item={item}
                disabled={
                  props.disabled ||
                  (props.active_edit_item_id !== undefined && props.active_edit_item_id !== null)
                }
                can_send_now={props.queue.canSendNow}
                editing={props.active_edit_item_id === item.id}
                render_editor={props.render_item_editor}
                on_edit={props.on_edit}
                on_delete={props.on_delete}
                on_send_now={props.on_send_now}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/** 单行根据 queued / sending 状态收口可用操作，不维护第二份本地状态。 */
function AgentInputQueueItem(props: {
  item: AgentQueuedInput;
  disabled: boolean;
  can_send_now: boolean;
  editing: boolean;
  render_editor?: (item: AgentQueuedInput) => ReactNode | null;
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
    id: props.item.id,
    disabled: item_actions_disabled,
  });
  if (editor !== null) {
    return (
      <li
        ref={sortable.setNodeRef}
        className="agent-input-queue__item agent-input-queue__item--editing"
        style={{
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        }}
      >
        {editor}
      </li>
    );
  }
  const attachment_count = props.item.attachments.length;
  const preview = props.item.text || t("agent_page.queue.no_message_text");
  return (
    <li
      ref={sortable.setNodeRef}
      className="agent-input-queue__item"
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="agent-input-queue__drag"
            disabled={item_actions_disabled}
            aria-label={t("agent_page.queue.reorder")}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{t("agent_page.queue.reorder")}</p>
        </TooltipContent>
      </Tooltip>
      <span className="agent-input-queue__preview" title={preview}>
        {preview}
      </span>
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
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{props.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
