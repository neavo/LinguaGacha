import type { StartTaskCommand } from "../../protocol/task-command";
import type { TaskDefinition, TaskPlan, WorkerResultInterpretation } from "../task-definition";
import type { WorkUnit } from "../../protocol/work-unit";
import type { WorkerExecutionResult } from "../../protocol/worker-result";
import { build_analysis_units } from "./analysis-unit-builder";
import { create_analysis_task_plan } from "./analysis-plan";
import { interpret_analysis_worker_result } from "./analysis-result-interpreter";

type AnalysisCommand = Extract<StartTaskCommand, { task_type: "analysis" }>;

/**
 * 分析 definition 声明 analysis reset / continue 的稳定边界；checkpoint 解释仍在迁移中的 Engine 内收敛
 */
export class AnalysisTaskDefinition implements TaskDefinition<AnalysisCommand> {
  public readonly task_type = "analysis" as const;

  public normalize_command(command: AnalysisCommand): AnalysisCommand {
    return command;
  }

  public revision_dependencies(_command: AnalysisCommand): string[] {
    return ["quality", "prompts"];
  }

  public prepare_plan(command: AnalysisCommand): TaskPlan {
    return create_analysis_task_plan(command);
  }

  public build_units(plan: TaskPlan): WorkUnit[] {
    return build_analysis_units(plan);
  }

  public interpret_worker_result(result: WorkerExecutionResult): WorkerResultInterpretation {
    return interpret_analysis_worker_result(result);
  }
}
