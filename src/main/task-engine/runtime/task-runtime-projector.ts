import type { ApiJsonValue } from "../../api/api-types";
import type { CoreEventPayload, CoreEventProjector } from "../../events/core-event-hub";
import { TaskRuntimeState } from "./task-runtime-state";
import type { JsonRecord } from "./task-runtime-types";

/**
 * 将公开 Core 事件投影到任务运行态，保证 SSE 与 task snapshot 使用同源事实。
 */
export class TaskRuntimeProjector implements CoreEventProjector {
  // task_runtime_state 是投影后的唯一写入目标，事件总线不直接理解任务状态。
  private readonly task_runtime_state: TaskRuntimeState;

  /**
   * 注入任务运行态权威，保持事件基础设施与任务领域解耦。
   */
  public constructor(task_runtime_state: TaskRuntimeState) {
    this.task_runtime_state = task_runtime_state;
  }

  /**
   * 根据公开事件 topic 选择对应运行态吸收规则。
   */
  public apply(event_type: string, payload: CoreEventPayload): void {
    if (event_type === "task.status_changed") {
      this.task_runtime_state.apply_status_event(payload);
      return;
    }
    if (event_type === "task.progress_changed") {
      this.task_runtime_state.apply_progress_event(payload);
      return;
    }
    if (event_type === "project.patch") {
      this.apply_project_patch(payload);
    }
  }

  /**
   * 从 project.patch 的 replace_task 操作回灌任务块，避免 snapshot 反查其它入口。
   */
  private apply_project_patch(payload: CoreEventPayload): void {
    const patch = payload["patch"];
    if (!Array.isArray(patch)) {
      return;
    }
    for (const raw_operation of patch) {
      if (!this.is_record(raw_operation)) {
        continue;
      }
      if (raw_operation["op"] === "replace_task" && this.is_record(raw_operation["task"])) {
        this.task_runtime_state.apply_task_snapshot(raw_operation["task"]);
      }
    }
  }

  /**
   * 普通对象判断集中处理，避免数组被当作 patch operation 或 task 块。
   */
  private is_record(value: ApiJsonValue | undefined): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
