import {
  is_active_analysis_task_status,
  is_active_translation_task_status,
  type TranslationScope,
} from "../../domain/task";

export type TranslationCompletionScenario =
  | "workbench-full-translation"
  | "proofreading-retranslation";

export function resolve_translation_completion_scenario(
  scope: TranslationScope,
): TranslationCompletionScenario {
  return scope.kind === "items" ? "proofreading-retranslation" : "workbench-full-translation";
}

export function should_open_translation_export_followup(args: {
  previous_status: string;
  next_status: string;
  has_result: boolean;
  scope: TranslationScope;
}): boolean {
  if (resolve_translation_completion_scenario(args.scope) !== "workbench-full-translation") {
    return false;
  }

  if (
    args.previous_status === "stopping" ||
    !is_active_translation_task_status(args.previous_status)
  ) {
    return false;
  }

  if (args.next_status === "done") {
    return true;
  }

  return args.next_status === "idle" && args.has_result;
}

export function should_open_analysis_glossary_import_followup(args: {
  previous_status: string;
  next_status: string;
  candidate_count: number;
}): boolean {
  if (args.candidate_count <= 0) {
    return false;
  }

  if (
    args.previous_status === "stopping" ||
    !is_active_analysis_task_status(args.previous_status)
  ) {
    return false;
  }

  return args.next_status === "done" || args.next_status === "idle";
}
