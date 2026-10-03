import type { JsonValue } from "../../domain/json";
import { copyJson } from "@earendil-works/chord";
import { uuidv7 } from "@earendil-works/pi-ai";

import {
  normalize_agent_message_input,
  AGENT_INPUT_QUEUE_LIMIT,
  type AgentInputQueueSnapshot,
  type AgentMessageInput,
  type AgentQueuedInput,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";

export type AgentInputQueueState = { items: AgentQueuedInput[]; paused: boolean };

/** 队列规则操作调用方传入的文档草稿；会话通过一次 commit 执行每个命令。 */
export class AgentInputQueue {
  /** 独立使用时持有本地状态，会话写入时传入事务草稿。 */
  public constructor(private readonly state: AgentInputQueueState = { items: [], paused: false }) {}
  /** continue 与自动续取只关心是否仍有任何待处理输入。 */
  public get has_items(): boolean {
    return this.state.items.length > 0;
  }

  /** 暂停只阻止 FIFO 自动续取，不阻止用户显式立即发送。 */
  public get is_paused(): boolean {
    return this.state.paused;
  }

  /** 快照克隆完整消息，避免 renderer 或事件发布方改写队列事实。 */
  public read_snapshot(can_send_now: boolean): AgentInputQueueSnapshot {
    return {
      paused: this.state.paused,
      canSendNow:
        can_send_now &&
        !this.state.items.some((item) => item.status === "sending") &&
        this.state.items.some((item) => item.status === "queued"),
      items: copy_queue_value(this.state.items),
    };
  }

  /** 入队时冻结消息并生成仅在当前会话稳定的身份。 */
  public enqueue(message: AgentMessageInput): AgentQueuedInput {
    if (this.state.items.length >= AGENT_INPUT_QUEUE_LIMIT) {
      throw queue_validation_error("agent_input_queue_full");
    }
    const item: AgentQueuedInput = {
      ...copy_queue_value(message),
      id: uuidv7(),
      status: "queued",
      createdAt: Date.now(),
    };
    this.state.items.push(item);
    return copy_queue_value(item);
  }

  /** 修改只替换消息内容，保留身份、位置和创建时间。 */
  public update(id: string, value: unknown): void {
    const index = this.find_queued_index(id);
    const message = normalize_agent_message_input(value);
    if (message === null) throw queue_validation_error("agent_input_queue_invalid_message");
    const current = this.state.items[index]!;
    this.state.items[index] = {
      ...copy_queue_value(message),
      id: current.id,
      status: "queued",
      createdAt: current.createdAt,
    };
  }

  /** 删除最后一项时同步清除已失去意义的暂停态。 */
  public delete(id: string): void {
    const index = this.find_queued_index(id);
    this.state.items.splice(index, 1);
    this.normalize_pause();
  }

  /** 重排必须是当前全部身份的完整排列，sending 项也不能被遗漏。 */
  public reorder(ids: readonly string[]): void {
    if (ids.length !== this.state.items.length || new Set(ids).size !== ids.length) {
      throw queue_validation_error("agent_input_queue_invalid_order");
    }
    const by_id = new Map(this.state.items.map((item) => [item.id, item]));
    const ordered = ids.map((id) => by_id.get(id));
    if (ordered.some((item) => item === undefined)) {
      throw queue_validation_error("agent_input_queue_invalid_order");
    }
    this.state.items = ordered as AgentQueuedInput[];
  }

  /** 异步准备运行时前读取选中项，但不提前移除。 */
  public read(id: string): AgentQueuedInput {
    const index = this.find_queued_index(id);
    return copy_queue_value(this.state.items[index]!);
  }

  /** 读取等待队首但不提交，准备完成后统一通过 commit_send 消费。 */
  public read_next(): AgentQueuedInput | null {
    if (this.state.paused || this.state.items.some((item) => item.status === "sending"))
      return null;
    const item = this.state.items.find((candidate) => candidate.status === "queued");
    return item === undefined ? null : copy_queue_value(item);
  }

  /** steer 受理前先占用队列项，保证同一时刻只有一个待提交输入。 */
  public begin_send(id: string): AgentQueuedInput {
    if (this.state.items.some((item) => item.status === "sending")) {
      throw new AppErrors.AppError("runtime.busy");
    }
    const index = this.find_queued_index(id);
    const current = this.state.items[index]!;
    const sending: AgentQueuedInput = { ...current, status: "sending" };
    this.state.items[index] = sending;
    return copy_queue_value(sending);
  }

  /** 仅收到 SDK 入历史事实后按草稿身份消费；停止回滚后的迟到确认也不会重复发送。 */
  public commit_send(id: string): AgentQueuedInput | null {
    const index = this.state.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const item = this.state.items.splice(index, 1)[0]!;
    this.normalize_pause();
    return copy_queue_value(item);
  }

  /** steer 未提交即失败或停止时，把占用项恢复为普通 queued。 */
  public cancel_send(): void {
    const index = this.state.items.findIndex((item) => item.status === "sending");
    const current = this.state.items[index];
    if (current !== undefined) this.state.items[index] = { ...current, status: "queued" };
  }

  /** 仅在仍有输入时进入暂停，空队列不制造不可恢复状态。 */
  public pause(): void {
    if (this.state.items.length > 0) this.state.paused = true;
  }

  /** continue 解除自动续取阻塞。 */
  public resume(): void {
    this.state.paused = false;
  }

  /** 所有可变操作共用 queued 身份检查，sending 因而天然不可改写。 */
  private find_queued_index(id: string): number {
    const index = this.state.items.findIndex((item) => item.id === id && item.status === "queued");
    if (index < 0) throw queue_validation_error("agent_input_queue_item_not_found");
    return index;
  }

  /** 空队列没有可恢复工作，暂停态必须随之归零。 */
  private normalize_pause(): void {
    if (this.state.items.length === 0) this.state.paused = false;
  }
}

/** 队列边界统一使用公开 validation code，并保留内部诊断原因。 */
function queue_validation_error(reason: string): AppErrors.AppError {
  return new AppErrors.AppError("request.validation_failed", { diagnostic_context: { reason } });
}

/** Chord 事务草稿是代理对象，JSON 复制保持类型并剥离代理引用。 */
function copy_queue_value<T extends JsonValue>(value: T): T {
  return copyJson(value) as T;
}
