import {
  build_analysis_progress_snapshot,
  build_analysis_status_summary,
  normalize_analysis_progress_snapshot,
  normalize_runtime_project_item_record,
} from "@/app/project-runtime/reset-derived";
import {
  createProjectStoreReplaceSectionPatch,
  type ProjectStorePatchOperation,
  type ProjectStoreState,
} from "@/app/project-runtime/project-store";

type AnalysisResetPreviewPayload = {
  status_summary?: Record<string, unknown>;
};

export type AnalysisResetPlan = {
  updatedSections: Array<"analysis" | "task">;
  patch: ProjectStorePatchOperation[];
  requestBody: Record<string, unknown>;
  next_task_snapshot: Record<string, unknown>;
};

function build_runtime_items(state: ProjectStoreState) {
  return Object.values(state.items).flatMap((item) => {
    const normalized_item = normalize_runtime_project_item_record(item);
    return normalized_item === null ? [] : [normalized_item];
  });
}

function normalize_status_summary(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    total_line: Number(value?.total_line ?? 0),
    processed_line: Number(value?.processed_line ?? 0),
    error_line: Number(value?.error_line ?? 0),
    line: Number(value?.line ?? 0),
  };
}

function normalize_record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, unknown>;
}

function pick_preserved_analysis_extras(extras: Record<string, unknown>): Record<string, unknown> {
  return {
    start_time: extras.start_time ?? 0.0,
    time: extras.time ?? 0.0,
    total_tokens: extras.total_tokens ?? 0,
    total_input_tokens: extras.total_input_tokens ?? 0,
    total_output_tokens: extras.total_output_tokens ?? 0,
  };
}

function build_next_task_snapshot(args: {
  task_snapshot: Record<string, unknown>;
  analysis_extras: Record<string, unknown>;
  analysis_candidate_count: number;
}): Record<string, unknown> {
  return {
    ...args.task_snapshot,
    ...args.analysis_extras,
    analysis_candidate_count: args.analysis_candidate_count,
  };
}

export function create_analysis_reset_all_plan(args: {
  state: ProjectStoreState;
}): AnalysisResetPlan {
  const status_summary = build_analysis_status_summary(build_runtime_items(args.state));
  const empty_analysis_extras: Record<string, unknown> = {};
  const analysis_extras = build_analysis_progress_snapshot({
    extras: empty_analysis_extras,
    status_summary,
  });
  const next_analysis_state = {
    ...args.state.analysis,
    extras: analysis_extras,
    candidate_count: 0,
    candidate_aggregate: {},
    status_summary,
  };
  const next_task_snapshot = build_next_task_snapshot({
    task_snapshot: args.state.task,
    analysis_extras,
    analysis_candidate_count: 0,
  });

  return {
    updatedSections: ["analysis", "task"],
    patch: [
      createProjectStoreReplaceSectionPatch("analysis", next_analysis_state),
      createProjectStoreReplaceSectionPatch("task", next_task_snapshot),
    ],
    requestBody: {
      mode: "all",
      analysis_extras: analysis_extras,
      expected_section_revisions: {
        analysis: args.state.revisions.sections.analysis ?? 0,
      },
    },
    next_task_snapshot,
  };
}

export async function create_analysis_reset_failed_plan(args: {
  state: ProjectStoreState;
  request_preview: () => Promise<AnalysisResetPreviewPayload>;
}): Promise<AnalysisResetPlan> {
  const preview_payload = await args.request_preview();
  const status_summary = normalize_status_summary(preview_payload.status_summary);
  const current_analysis_extras = normalize_record(args.state.analysis.extras);
  const analysis_extras = build_analysis_progress_snapshot({
    extras: pick_preserved_analysis_extras(
      normalize_analysis_progress_snapshot(current_analysis_extras),
    ),
    status_summary,
  });
  const analysis_candidate_count = Number(
    args.state.analysis.candidate_count ?? args.state.task.analysis_candidate_count ?? 0,
  );
  const next_analysis_state = {
    ...args.state.analysis,
    extras: analysis_extras,
    status_summary,
  };
  const next_task_snapshot = build_next_task_snapshot({
    task_snapshot: args.state.task,
    analysis_extras,
    analysis_candidate_count,
  });

  return {
    updatedSections: ["analysis", "task"],
    patch: [
      createProjectStoreReplaceSectionPatch("analysis", next_analysis_state),
      createProjectStoreReplaceSectionPatch("task", next_task_snapshot),
    ],
    requestBody: {
      mode: "failed",
      analysis_extras: analysis_extras,
      expected_section_revisions: {
        analysis: args.state.revisions.sections.analysis ?? 0,
      },
    },
    next_task_snapshot,
  };
}
