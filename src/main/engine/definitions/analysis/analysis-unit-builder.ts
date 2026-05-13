import type { WorkUnit } from "../../protocol/work-unit";
import type { TaskPlan } from "../task-definition";

/**
 * 分析 unit 构建入口；保持任务差异文件结构与计划一致
 */
export function build_analysis_units(plan: TaskPlan): WorkUnit[] {
  return plan.units;
}
