import type { StartTaskCommand } from "../../protocol/task-command";
import type { TaskPlan } from "../task-definition";

type AnalysisCommand = Extract<StartTaskCommand, { task_type: "analysis" }>;

/**
 * 构造分析任务计划；当前真实 checkpoint 切分仍由 Engine 持有
 */
export function create_analysis_task_plan(command: AnalysisCommand): TaskPlan {
  return { task_type: command.task_type, progress: {}, units: [] };
}
