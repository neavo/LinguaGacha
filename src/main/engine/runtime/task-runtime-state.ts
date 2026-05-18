import type { ApiJsonValue } from "../../api/api-types";
import type { TaskRunStatus, TaskRuntimeStatePayload, TaskType } from "./task-runtime-types";
import type { TranslationScope } from "../protocol/task-types";

const IDLE_TASK_TYPE = "idle"; // Engine 空闲态统一用 idle 表达，避免快照泄漏任务类型细节

/**
 * API Gateway 内的任务运行态权威
 */
export class TaskRuntimeState {
  private status: TaskRunStatus = "idle"; // status 是 Engine 运行态唯一状态机值，renderer 如需展示另行映射

  private busy = false; // busy 是同步 mutation、reset preview 和任务按钮共享的唯一运行时互斥事实

  private active_task_type = IDLE_TASK_TYPE; // active_task_type 表示当前活跃任务；空闲时必须回到 idle，不能停在上一轮任务

  private request_in_flight_count = 0; // request_in_flight_count 只表示真实已发出的请求数，不表达队列长度

  private translation_scope: TranslationScope = { kind: "all" }; // 重翻行级 spinner 只依赖 items scope，不能混入普通翻译任务状态

  private runtime_revision = 0; // 后端任务快照单调序号，renderer 只用它丢弃旧 snapshot

  /**
   * 返回不可变快照，调用方不能拿内部数组引用继续改写运行态
   */
  public snapshot(): TaskRuntimeStatePayload {
    return {
      runtime_revision: this.runtime_revision,
      status: this.status,
      busy: this.busy,
      request_in_flight_count: this.request_in_flight_count,
      active_task_type: this.active_task_type,
      translation_scope: this.clone_translation_scope(this.translation_scope),
    };
  }

  /**
   * 任务命令被 TaskService 受理后立即占用运行态，避免按钮等到下一帧 SSE 才变化
   */
  public begin_task(task_type: TaskType, scope: TranslationScope = { kind: "all" }): void {
    this.status = "requested";
    this.busy = true;
    this.active_task_type = task_type;
    if (task_type === "translation") {
      this.translation_scope = this.normalize_translation_scope(scope);
    }
    this.bump_runtime_revision();
  }

  /**
   * 命令调用失败时恢复前置快照，避免乐观占用造成永久忙碌
   */
  public restore(snapshot: TaskRuntimeStatePayload): void {
    this.status = snapshot.status;
    this.busy = snapshot.busy;
    this.request_in_flight_count = snapshot.request_in_flight_count;
    this.active_task_type = snapshot.active_task_type;
    this.translation_scope = this.normalize_translation_scope(snapshot.translation_scope);
    this.bump_runtime_revision();
  }

  /**
   * 写入任务生命周期状态；调用方必须已经完成任务类型收窄
   */
  public set_status(task_type: TaskType, status: TaskRunStatus, busy: boolean): void {
    this.status = status;
    this.busy = busy;
    this.active_task_type = this.busy ? task_type : IDLE_TASK_TYPE;
    if (!this.busy) {
      this.request_in_flight_count = 0;
      if (task_type === "translation" || this.active_task_type === IDLE_TASK_TYPE) {
        this.translation_scope = { kind: "all" };
      }
    }
    this.bump_runtime_revision();
  }

  /**
   * 任务提交进度后保持活跃任务类型，进度数值本身由 `.lg` meta 作为快照来源
   */
  public mark_progress_committed(task_type: TaskType): void {
    if (this.busy) {
      this.active_task_type = task_type;
    }
    this.bump_runtime_revision();
  }

  /**
   * 请求压力只写真实已发请求数，发布节奏由 TaskRuntimePublisher 决定
   */
  public set_request_in_flight_count(task_type: TaskType, value: number): void {
    if (this.busy) {
      this.active_task_type = task_type;
    }
    this.request_in_flight_count = Math.max(0, this.read_number(value, 0));
    this.bump_runtime_revision();
  }

  /**
   * 重翻提交完成后移除已回写行，避免单批 patch 之后 spinner 残留
   */
  public remove_translation_item_ids(item_ids: number[]): void {
    if (this.translation_scope.kind !== "items") {
      return;
    }
    const done_ids = new Set(this.normalize_item_ids(item_ids));
    this.translation_scope = {
      kind: "items",
      item_ids: this.translation_scope.item_ids.filter((item_id) => !done_ids.has(item_id)),
    };
    this.bump_runtime_revision();
  }

  /**
   * 公开 snapshot 只按后端单调 revision 排序，避免 HTTP 回包与 SSE 乱序互相覆盖
   */
  private bump_runtime_revision(): void {
    this.runtime_revision += 1;
  }

  /**
   * 数字字段统一截断，保护快照中不会出现 NaN 或小数请求数
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * item id 列表必须去重且为正整数，避免 renderer 行级状态被脏载荷污染
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

  /**
   * translation scope 是翻译范围唯一语义源；非法或空 items scope 回退为 all，命令边界负责报错
   */
  private normalize_translation_scope(
    value: TranslationScope | ApiJsonValue | undefined,
  ): TranslationScope {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { kind: "all" };
    }
    const record = value as Record<string, ApiJsonValue>;
    if (record["kind"] !== "items") {
      return { kind: "all" };
    }
    const item_ids = this.normalize_item_ids(record["item_ids"]);
    return item_ids.length > 0 ? { kind: "items", item_ids } : { kind: "all" };
  }

  /**
   * snapshot 不能泄漏内部数组引用
   */
  private clone_translation_scope(scope: TranslationScope): TranslationScope {
    return scope.kind === "items"
      ? { kind: "items", item_ids: [...scope.item_ids] }
      : { kind: "all" };
  }
}
