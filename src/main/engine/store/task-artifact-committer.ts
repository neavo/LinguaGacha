import type { ApiJsonValue } from "../../api/api-types";
import type { TaskArtifact } from "../protocol/artifact";
import type { TaskType } from "../protocol/task-types";
import type { JsonRecord, MutableJsonRecord } from "../runtime/task-runtime-types";
import { ProjectTaskStore } from "./project-task-store";

/**
 * 任务 artifact 提交入口；Engine 只提交 artifact，不理解数据库 operation 形状
 */
export class TaskArtifactCommitter {
  /**
   * ProjectTaskStore 是 `.lg` 项目任务事实唯一写入口，committer 只负责 artifact 分发
   */
  public constructor(private readonly task_store: ProjectTaskStore) {}

  /**
   * 提交任务 artifact 与进度快照，返回 ProjectTaskStore 的最小变更回执
   */
  public commit(
    task_type: TaskType,
    artifacts: TaskArtifact[],
    progress: MutableJsonRecord,
  ): MutableJsonRecord {
    return this.task_store.commit_artifacts({
      task_type,
      artifacts: artifacts as unknown as ApiJsonValue,
      progress_snapshot: progress as unknown as ApiJsonValue,
    } satisfies JsonRecord);
  }
}
