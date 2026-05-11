import type { ApiJsonValue } from "../api/api-types";
import type { JsonRecord, TaskEngineStatePayload, TaskType } from "./task-types";

// Engine 空闲态统一用 idle 表达，避免快照里继续泄漏旧任务类型。
const IDLE_TASK_TYPE = "idle";

// 这些终态不会再占用全局任务锁，任务 busy 权威必须在入站事件处即时释放。
const IDLE_STATUSES = new Set(["DONE", "ERROR", "IDLE"]);

/**
 * API Gateway 内的任务运行态权威，替代旧任务状态查询。
 */
export class TaskRuntimeState {
  // status 保留 Engine 公开字符串，避免前端按钮态在迁移期间换语义。
  private status = "IDLE";

  // busy 是同步 mutation、reset preview 和任务按钮共享的唯一运行时互斥事实。
  private busy = false;

  // active_task_type 表示当前活跃任务；空闲时必须回到 idle，不能停在上一轮任务。
  private active_task_type = IDLE_TASK_TYPE;

  // request_in_flight_count 只表示真实已发出的请求数，不表达队列长度。
  private request_in_flight_count = 0;

  // 重翻行级 spinner 依赖这份 id 集合，不能混入普通翻译任务状态。
  private retranslating_item_ids: number[] = [];

  /**
   * 返回不可变快照，调用方不能拿内部数组引用继续改写运行态。
   */
  public snapshot(): TaskEngineStatePayload {
    return {
      status: this.status,
      busy: this.busy,
      request_in_flight_count: this.request_in_flight_count,
      active_task_type: this.active_task_type,
      retranslating_item_ids: [...this.retranslating_item_ids],
    };
  }

  /**
   * 任务命令被 TaskService 受理后立即占用运行态，避免按钮等到下一帧 SSE 才变化。
   */
  public begin_task(task_type: TaskType, item_ids: number[] = []): void {
    this.status = "REQUEST";
    this.busy = true;
    this.active_task_type = task_type;
    if (task_type === "retranslate") {
      this.retranslating_item_ids = this.normalize_item_ids(item_ids);
    }
  }

  /**
   * 停止命令只改变运行态意图，真实终态仍由 Engine 后续事件收口。
   */
  public mark_stopping(task_type: TaskType): void {
    this.status = "STOPPING";
    this.busy = true;
    this.active_task_type = task_type;
  }

  /**
   * 命令调用失败时恢复旧快照，避免 乐观占用造成永久忙碌。
   */
  public restore(snapshot: TaskEngineStatePayload): void {
    this.status = snapshot.status;
    this.busy = snapshot.busy;
    this.request_in_flight_count = snapshot.request_in_flight_count;
    this.active_task_type = snapshot.active_task_type;
    this.retranslating_item_ids = this.normalize_item_ids(snapshot.retranslating_item_ids);
  }

  /**
   * 从公开 task.status_changed 事件吸收 Engine 状态，保持事件流和快照同源。
   */
  public apply_status_event(payload: JsonRecord): void {
    const task_type = this.read_task_type(payload);
    const status = typeof payload["status"] === "string" ? payload["status"] : this.status;
    this.status = status;
    this.busy = this.read_boolean(payload["busy"], !IDLE_STATUSES.has(status));
    this.active_task_type = this.busy && task_type !== null ? task_type : IDLE_TASK_TYPE;
    if (!this.busy) {
      this.request_in_flight_count = 0;
      if (task_type === "retranslate" || this.active_task_type === IDLE_TASK_TYPE) {
        this.retranslating_item_ids = [];
      }
    }
  }

  /**
   * 从进度事件吸收实时请求数；缺字段时不能清掉已有完整快照。
   */
  public apply_progress_event(payload: JsonRecord): void {
    const task_type = this.read_task_type(payload);
    if (task_type !== null && this.busy) {
      this.active_task_type = task_type;
    }
    if ("request_in_flight_count" in payload) {
      this.request_in_flight_count = this.read_number(payload["request_in_flight_count"], 0);
    }
  }

  /**
   * project.patch 里的 replace_task 是任务块最终口径，需要回灌到 运行态。
   */
  public apply_task_snapshot(payload: JsonRecord): void {
    const task_type = this.read_task_type(payload);
    this.status = typeof payload["status"] === "string" ? payload["status"] : this.status;
    this.busy = this.read_boolean(payload["busy"], !IDLE_STATUSES.has(this.status));
    this.request_in_flight_count = this.read_number(
      payload["request_in_flight_count"],
      this.request_in_flight_count,
    );
    this.active_task_type = this.busy && task_type !== null ? task_type : IDLE_TASK_TYPE;
    if (task_type === "retranslate" || Array.isArray(payload["retranslating_item_ids"])) {
      this.retranslating_item_ids = this.normalize_item_ids(payload["retranslating_item_ids"]);
    }
    if (!this.busy && task_type === "retranslate") {
      this.retranslating_item_ids = [];
    }
  }

  /**
   * 重翻提交完成后移除已回写行，避免单批 patch 之后 spinner 残留。
   */
  public remove_retranslating_item_ids(item_ids: number[]): void {
    const done_ids = new Set(this.normalize_item_ids(item_ids));
    this.retranslating_item_ids = this.retranslating_item_ids.filter(
      (item_id) => !done_ids.has(item_id),
    );
  }

  /**
   * 构建可直接放入 project.patch 的 task 块，复用当前 runtime state。
   */
  public build_task_block(task_type: TaskType): JsonRecord {
    const snapshot = this.snapshot();
    return {
      task_type,
      status: snapshot.status,
      busy: snapshot.busy,
      request_in_flight_count: snapshot.request_in_flight_count,
      line: 0,
      total_line: 0,
      processed_line: 0,
      error_line: 0,
      total_tokens: 0,
      total_output_tokens: 0,
      total_input_tokens: 0,
      time: 0,
      start_time: 0,
      ...(task_type === "retranslate"
        ? { retranslating_item_ids: snapshot.retranslating_item_ids as unknown as ApiJsonValue }
        : {}),
    };
  }

  /**
   * 只接受公开三类任务名，避免未知 topic 把运行态带偏。
   */
  private read_task_type(payload: JsonRecord): TaskType | null {
    const task_type = String(payload["task_type"] ?? "");
    if (task_type === "translation" || task_type === "analysis" || task_type === "retranslate") {
      return task_type;
    }
    return null;
  }

  /**
   * 布尔读取集中处理，兼容旧事件没有 busy 字段的情况。
   */
  private read_boolean(value: ApiJsonValue | undefined, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  /**
   * 数字字段统一截断，保护快照中不会出现 NaN 或小数请求数。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * item id 列表必须去重且为正整数，避免 renderer 行级状态被脏载荷污染。
   */
  private normalize_item_ids(value: ApiJsonValue | number[] | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const result: number[] = [];
    const seen = new Set<number>();
    for (const raw_item_id of value) {
      const item_id = this.read_number(raw_item_id as ApiJsonValue, NaN);
      if (!Number.isFinite(item_id) || item_id <= 0 || seen.has(item_id)) {
        continue;
      }
      seen.add(item_id);
      result.push(item_id);
    }
    return result;
  }
}
