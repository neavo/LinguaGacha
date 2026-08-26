import { uuidv7 } from "@earendil-works/pi-ai";

import {
  normalize_agent_message_input,
  AGENT_INPUT_QUEUE_LIMIT,
  type AgentInputQueueSnapshot,
  type AgentMessageInput,
  type AgentQueuedInput,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";

/** 输入队列只拥有排队事实；运行时何时取用由 AgentService 编排。 */
export class AgentInputQueue {
  private items: AgentQueuedInput[] = []; // 当前会话唯一的有序输入事实
  private paused = false; // 失败或 stop 后阻断自动 FIFO，显式操作仍可恢复

  /** continue 与自动续取只关心是否仍有任何待处理输入。 */
  public get has_items(): boolean {
    return this.items.length > 0;
  }

  /** 暂停只阻止 FIFO 自动续取，不阻止用户显式立即发送。 */
  public get is_paused(): boolean {
    return this.paused;
  }

  /** 快照克隆完整消息，避免 renderer 或事件发布方改写队列事实。 */
  public read_snapshot(can_send_now: boolean): AgentInputQueueSnapshot {
    return {
      paused: this.paused,
      canSendNow:
        can_send_now &&
        !this.items.some((item) => item.status === "sending") &&
        this.items.some((item) => item.status === "queued"),
      items: structuredClone(this.items),
    };
  }

  /** 入队时冻结消息并生成仅在当前会话稳定的身份。 */
  public enqueue(message: AgentMessageInput): AgentQueuedInput {
    if (this.items.length >= AGENT_INPUT_QUEUE_LIMIT) {
      throw queue_validation_error("agent_input_queue_full");
    }
    const item: AgentQueuedInput = {
      ...structuredClone(message),
      id: uuidv7(),
      status: "queued",
      createdAt: Date.now(),
    };
    this.items.push(item);
    return structuredClone(item);
  }

  /** 修改只替换消息内容，保留身份、位置和创建时间。 */
  public update(id: string, value: unknown): void {
    const index = this.find_queued_index(id);
    const message = normalize_agent_message_input(value);
    if (message === null) throw queue_validation_error("agent_input_queue_invalid_message");
    const current = this.items[index]!;
    this.items[index] = {
      ...structuredClone(message),
      id: current.id,
      status: "queued",
      createdAt: current.createdAt,
    };
  }

  /** 删除最后一项时同步清除已失去意义的暂停态。 */
  public delete(id: string): void {
    const index = this.find_queued_index(id);
    this.items.splice(index, 1);
    this.normalize_pause();
  }

  /** 重排必须是当前全部身份的完整排列，sending 项也不能被遗漏。 */
  public reorder(ids: readonly string[]): void {
    if (ids.length !== this.items.length || new Set(ids).size !== ids.length) {
      throw queue_validation_error("agent_input_queue_invalid_order");
    }
    const by_id = new Map(this.items.map((item) => [item.id, item]));
    const ordered = ids.map((id) => by_id.get(id));
    if (ordered.some((item) => item === undefined)) {
      throw queue_validation_error("agent_input_queue_invalid_order");
    }
    this.items = ordered as AgentQueuedInput[];
  }

  /** 自动续取遵守暂停态，并在 steer 尚未提交时保持 FIFO 不动。 */
  public take_next(): AgentQueuedInput | null {
    if (this.paused || this.items.some((item) => item.status === "sending")) return null;
    const index = this.items.findIndex((item) => item.status === "queued");
    if (index < 0) return null;
    const item = this.items.splice(index, 1)[0]!;
    this.normalize_pause();
    return structuredClone(item);
  }

  /** 显式启动选中项时只允许提交仍处于 queued 的身份。 */
  public take(id: string): AgentQueuedInput {
    const index = this.find_queued_index(id);
    const item = this.items.splice(index, 1)[0]!;
    this.normalize_pause();
    return structuredClone(item);
  }

  /** 异步准备运行时前读取选中项，但不提前移除。 */
  public read(id: string): AgentQueuedInput {
    const index = this.find_queued_index(id);
    return structuredClone(this.items[index]!);
  }

  /** continue 在取得 lease 后读取当前 FIFO 队首。 */
  public read_next(): AgentQueuedInput | null {
    const item = this.items.find((candidate) => candidate.status === "queued");
    return item === undefined ? null : structuredClone(item);
  }

  /** checkpoint 抢先于 Pi steer 时读取唯一待提交输入。 */
  public read_sending(): AgentQueuedInput | null {
    const item = this.items.find((candidate) => candidate.status === "sending");
    return item === undefined ? null : structuredClone(item);
  }

  /** steer 受理前先占用队列项，保证同一时刻只有一个待提交输入。 */
  public begin_send(id: string): AgentQueuedInput {
    if (this.items.some((item) => item.status === "sending")) {
      throw new AppErrors.AppError("runtime.busy");
    }
    const index = this.find_queued_index(id);
    const current = this.items[index]!;
    const sending: AgentQueuedInput = { ...current, status: "sending" };
    this.items[index] = sending;
    return structuredClone(sending);
  }

  /** Pi 确认消费 user 后才从队列永久移除 sending 项。 */
  public commit_send(): AgentQueuedInput | null {
    const index = this.items.findIndex((item) => item.status === "sending");
    if (index < 0) return null;
    const item = this.items.splice(index, 1)[0]!;
    this.normalize_pause();
    return structuredClone(item);
  }

  /** steer 未提交即失败或停止时，把占用项恢复为普通 queued。 */
  public cancel_send(): void {
    const index = this.items.findIndex((item) => item.status === "sending");
    const current = this.items[index];
    if (current !== undefined) this.items[index] = { ...current, status: "queued" };
  }

  /** 仅在仍有输入时进入暂停，空队列不制造不可恢复状态。 */
  public pause(): void {
    if (this.items.length > 0) this.paused = true;
  }

  /** continue 解除自动续取阻塞。 */
  public resume(): void {
    this.paused = false;
  }

  /** 会话重置同时清空内容与暂停事实。 */
  public reset(): void {
    this.items = [];
    this.paused = false;
  }

  /** 所有可变操作共用 queued 身份检查，sending 因而天然不可改写。 */
  private find_queued_index(id: string): number {
    const index = this.items.findIndex((item) => item.id === id && item.status === "queued");
    if (index < 0) throw queue_validation_error("agent_input_queue_item_not_found");
    return index;
  }

  /** 空队列没有可恢复工作，暂停态必须随之归零。 */
  private normalize_pause(): void {
    if (this.items.length === 0) this.paused = false;
  }
}

/** 队列边界统一使用公开 validation code，并保留内部诊断原因。 */
function queue_validation_error(reason: string): AppErrors.AppError {
  return new AppErrors.AppError("request.validation_failed", { diagnostic_context: { reason } });
}
