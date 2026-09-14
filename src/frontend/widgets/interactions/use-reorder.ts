import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragDropEventHandlers, DragDropManager } from "@dnd-kit/react";

import { move_ordered_ids } from "./reorder";
import { useWindowDeactivation } from "./use-window-deactivation";

type ReorderSession = {
  source_ids: readonly string[]; // 起始身份顺序同时用于变更检测和稳定序号。
  ordered_ids: string[]; // 只保存顺序，内容始终由调用方提供。
} & (
  | {
      phase: "dragging";
      source_id: string;
      disabled_ids: readonly string[];
      moving_ids: readonly string[];
    }
  | { phase: "saving" }
);

/** 身份与顺序共同决定一次拖动是否仍对应当前列表。 */
function same_ids(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

const EMPTY_IDS: readonly string[] = [];

/** 单次重排的预览与提交互斥；调用方拥有成员、选区、持久化和错误反馈。 */
export function useReorder(args: {
  ids: readonly string[];
  disabled: boolean;
  disabled_ids?: readonly string[];
  moving_ids?: (source_id: string) => readonly string[];
  on_reorder?: (ids: string[]) => Promise<void>;
}) {
  const [session, set_session] = useState<ReorderSession | null>(null);
  // dragover 和 dragend 可在同一次 React 提交前到达，事件入口必须读取同一份最新预览。
  const session_ref = useRef<ReorderSession | null>(null);
  const manager_ref = useRef<DragDropManager | null>(null);
  const keyboard_focus_ref = useRef<{ id: string; handle: HTMLElement } | null>(null);
  const disabled_ids = args.disabled_ids ?? EMPTY_IDS;

  /** 同步事件读取与 React 下一次渲染，避免同帧落点丢失。 */
  function update_session(next: ReorderSession | null): void {
    session_ref.current = next;
    set_session(next);
  }

  /** 外部变化或窗口失活使当前拖动失效，取消库反馈并释放预览。 */
  function cancel(): void {
    if (session_ref.current?.phase !== "dragging") return;
    keyboard_focus_ref.current = null;
    update_session(null);
    manager_ref.current?.actions.stop({ canceled: true });
  }

  const valid_drag =
    session?.phase !== "dragging" ||
    (!args.disabled &&
      same_ids(session.source_ids, args.ids) &&
      same_ids(session.disabled_ids, disabled_ids));
  useLayoutEffect(() => {
    if (!valid_drag) cancel();
    const focus = keyboard_focus_ref.current;
    if (session !== null || args.disabled || focus === null) return;
    keyboard_focus_ref.current = null;
    // 保存期的原生 disabled 会清除焦点；只在用户未转向其它控件时归还同一身份的手柄。
    const handle = manager_ref.current?.registry.draggables.get(focus.id)?.handle ?? focus.handle;
    if (
      handle instanceof HTMLElement &&
      handle.isConnected &&
      document.hasFocus() &&
      (document.activeElement === document.body || document.activeElement === focus.handle)
    ) {
      handle.focus({ preventScroll: true });
    }
  });
  useWindowDeactivation(() => {
    keyboard_focus_ref.current = null;
    cancel();
  });
  useEffect(
    () => () => {
      const dragging = session_ref.current?.phase === "dragging";
      session_ref.current = null;
      if (dragging) manager_ref.current?.actions.stop({ canceled: true });
    },
    [],
  );

  /** 菜单与拖动共用提交锁，无变化不触达持久化入口。 */
  function submit(ids: string[]): boolean {
    if (
      args.disabled ||
      args.on_reorder === undefined ||
      session_ref.current?.phase === "saving" ||
      same_ids(ids, args.ids)
    )
      return false;
    const saving: ReorderSession = {
      phase: "saving",
      source_ids: args.ids,
      ordered_ids: ids,
    };
    update_session(saving);
    // resolve/reject 都表示调用方已处理保存与刷新，随后交回当前权威顺序。
    const settle = (): void => {
      if (session_ref.current === saving) update_session(null);
    };
    const on_reorder = args.on_reorder;
    void (async () => on_reorder(ids))().then(settle, settle);
    return true;
  }

  /** 在合法起拖时保存身份及移动组，正文更新不冻结。 */
  const onDragStart: DragDropEventHandlers["onDragStart"] = (event, manager) => {
    const source_id = event.operation.source?.id;
    if (
      args.disabled ||
      session_ref.current !== null ||
      typeof source_id !== "string" ||
      !args.ids.includes(source_id) ||
      disabled_ids.includes(source_id)
    ) {
      manager.actions.stop({ canceled: true });
      return;
    }
    manager_ref.current = manager;
    const handle = event.operation.source?.handle;
    keyboard_focus_ref.current =
      event.operation.activatorEvent instanceof KeyboardEvent && handle instanceof HTMLElement
        ? { id: source_id, handle }
        : null;
    update_session({
      phase: "dragging",
      source_id,
      source_ids: args.ids,
      disabled_ids,
      moving_ids: args.moving_ids?.(source_id) ?? [source_id],
      ordered_ids: [...args.ids],
    });
  };

  /** 只在落点改变排列时更新预览，沿用同一整组移动规则。 */
  const onDragOver: DragDropEventHandlers["onDragOver"] = (event) => {
    const current = session_ref.current;
    const target_id = event.operation.target?.id;
    if (
      current?.phase !== "dragging" ||
      typeof target_id !== "string" ||
      disabled_ids.includes(target_id)
    )
      return;
    const ordered_ids = move_ordered_ids({
      ordered_ids: current.ordered_ids,
      moving_ids: current.moving_ids,
      target: { id: target_id },
    });
    if (!same_ids(ordered_ids, current.ordered_ids)) update_session({ ...current, ordered_ids });
  };

  /** 松手提交最后一次预览，取消和过期事件都交回权威顺序。 */
  const onDragEnd: DragDropEventHandlers["onDragEnd"] = (event) => {
    const current = session_ref.current;
    if (current?.phase !== "dragging") return;
    if (
      event.canceled ||
      event.operation.target === null ||
      args.disabled ||
      !same_ids(current.source_ids, args.ids) ||
      !same_ids(current.disabled_ids, disabled_ids)
    ) {
      update_session(null);
      return;
    }
    update_session(null);
    submit(current.ordered_ids);
  };

  // 保存期成员可能因业务操作变化；丢弃失效投影，不能将已删除项目重新显示出来。
  const current_ids = new Set(args.ids);
  const usable_order =
    valid_drag &&
    session !== null &&
    session.ordered_ids.length === args.ids.length &&
    session.ordered_ids.every((id) => current_ids.has(id));
  return {
    ordered_ids: usable_order ? session.ordered_ids : args.ids,
    source_ids: usable_order ? session.source_ids : null, // 预览与保存期间共用起始身份顺序。
    active_id: valid_drag && session?.phase === "dragging" ? session.source_id : null,
    pending: session?.phase === "saving",
    events: { onDragStart, onDragOver, onDragEnd },
    submit,
  };
}
