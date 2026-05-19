import type { StartTaskCommand } from "../../protocol/task-command";
import type { TaskDefinition, TaskPlan, WorkerResultInterpretation } from "../task-definition";
import type { WorkUnit } from "../../protocol/work-unit";
import type { WorkerExecutionResult } from "../../protocol/worker-result";
import { build_translation_units } from "./translation-unit-builder";
import { create_translation_task_plan } from "./translation-plan";
import { interpret_translation_worker_result } from "./translation-result-interpreter";

type TranslationCommand = Extract<StartTaskCommand, { task_type: "translation" }>;

/**
 * 翻译 definition 声明普通翻译与重翻的稳定边界；具体切块解释仍在迁移中的 Engine 内收敛
 */
export class TranslationTaskDefinition implements TaskDefinition<TranslationCommand> {
  public readonly task_type = "translation" as const;

  public normalize_command(command: TranslationCommand): TranslationCommand {
    return command;
  }

  public revision_dependencies(command: TranslationCommand): string[] {
    return command.scope.kind === "items"
      ? ["items", "proofreading", "quality", "prompts"]
      : ["quality", "prompts"];
  }

  public prepare_plan(command: TranslationCommand): TaskPlan {
    return create_translation_task_plan(command);
  }

  public build_units(plan: TaskPlan): WorkUnit[] {
    return build_translation_units(plan);
  }

  public interpret_worker_result(result: WorkerExecutionResult): WorkerResultInterpretation {
    return interpret_translation_worker_result(result);
  }
}
