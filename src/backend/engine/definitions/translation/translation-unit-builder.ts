import type { WorkUnit } from "../../protocol/work-unit";
import type { TaskPlan } from "../task-definition";

/**
 * 翻译 unit 构建入口；后续真实切块迁入时只替换这里，不改 Definition 门面
 */
export function build_translation_units(plan: TaskPlan): WorkUnit[] {
  return plan.units;
}
