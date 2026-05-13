import type { CoreEventPayload, CoreEventProjector } from "../../events/core-event-hub";
import { TaskRuntimeState } from "./task-runtime-state";

/**
 * 将公开 Core 事件投影到任务运行态，保证 SSE 与 task snapshot 使用同源事实
 */
export class TaskRuntimeProjector implements CoreEventProjector {
  private readonly task_runtime_state: TaskRuntimeState; // task_runtime_state 是投影后的唯一写入目标，事件总线不直接理解任务状态

  /**
   * 注入任务运行态权威，保持事件基础设施与任务领域解耦
   */
  public constructor(task_runtime_state: TaskRuntimeState) {
    this.task_runtime_state = task_runtime_state;
  }

  /**
   * 根据公开事件 topic 选择对应运行态吸收规则
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
  }
}
