import type { StartTaskCommand } from "../../protocol/task-command";
import type { TaskPlan } from "../task-definition";

type TranslationCommand = Extract<StartTaskCommand, { task_type: "translation" }>;

/**
 * 构造翻译任务计划；当前 Engine 仍拥有真实切块，definition 先固定计划边界
 */
export function create_translation_task_plan(command: TranslationCommand): TaskPlan {
  return { task_type: command.task_type, progress: {}, units: [] };
}
