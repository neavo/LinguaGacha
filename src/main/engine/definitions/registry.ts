import type { StartTaskCommand } from "../protocol/task-command";
import type { TaskType } from "../protocol/task-types";
import { app_error } from "../../api/app-error";
import type { TaskDefinition } from "./task-definition";

/**
 * Definition 注册表是任务类型到业务差异解释器的唯一映射
 */
export class TaskDefinitionRegistry {
  private readonly definitions = new Map<TaskType, TaskDefinition>();

  /**
   * 注册时按 task_type 覆盖，启动期只保留一个权威 definition
   */
  public register(definition: TaskDefinition): void {
    this.definitions.set(definition.task_type, definition);
  }

  /**
   * 根据命令取 definition，未知任务类型直接失败而不是回退旧分支
   */
  public get(command: StartTaskCommand): TaskDefinition {
    const definition = this.definitions.get(command.task_type);
    if (definition === undefined) {
      throw app_error("internal_invariant", `未注册任务定义：${command.task_type}`);
    }
    return definition;
  }
}
