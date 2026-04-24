import { api_fetch } from "@/app/desktop-api";
import {
  createProjectStoreReplaceSectionPatch,
  type ProjectStoreState,
} from "@/app/project/store/project-store";
import {
  normalize_project_mutation_ack,
  type LocalProjectPatchCommit,
  type LocalProjectPatchInput,
  type ProjectMutationAck,
  type ProjectMutationAckPayload,
} from "@/app/runtime/desktop/desktop-runtime-context";
import type {
  ProjectPrefilterMutationInput,
  ProjectPrefilterMutationOutput,
} from "@/app/project/derived/project-prefilter";

type ApplyProjectPrefilterMutationArgs = {
  state: ProjectStoreState;
  source_language: string;
  mtool_optimizer_enable: boolean;
  compute_prefilter: (
    input: ProjectPrefilterMutationInput,
  ) => Promise<ProjectPrefilterMutationOutput>;
  commit_local_project_patch: (input: LocalProjectPatchInput) => LocalProjectPatchCommit;
  align_project_runtime_ack: (ack: ProjectMutationAck) => void;
  refresh_project_runtime: () => Promise<void>;
};

function serialize_prefilter_items(
  items: Record<string, Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return Object.values(items).map((item) => {
    return {
      id: Number(item.item_id ?? item.id ?? 0),
      file_path: String(item.file_path ?? ""),
      row: Number(item.row_number ?? item.row ?? 0),
      src: String(item.src ?? ""),
      dst: String(item.dst ?? ""),
      name_dst: item.name_dst ?? null,
      status: String(item.status ?? ""),
      text_type: String(item.text_type ?? "NONE"),
      retry_count: Number(item.retry_count ?? 0),
    };
  });
}

export async function apply_project_prefilter_mutation(
  args: ApplyProjectPrefilterMutationArgs,
): Promise<ProjectPrefilterMutationOutput> {
  const mutation_output = await args.compute_prefilter({
    state: args.state,
    source_language: args.source_language,
    mtool_optimizer_enable: args.mtool_optimizer_enable,
  });
  const local_commit = args.commit_local_project_patch({
    source: "project_apply_prefilter",
    updatedSections: ["items", "analysis", "task"],
    patch: [
      createProjectStoreReplaceSectionPatch("items", mutation_output.items),
      createProjectStoreReplaceSectionPatch("analysis", mutation_output.analysis),
      createProjectStoreReplaceSectionPatch("task", mutation_output.task_snapshot),
    ],
  });

  try {
    const mutation_ack = normalize_project_mutation_ack(
      await api_fetch<ProjectMutationAckPayload>("/api/project/apply-prefilter", {
        items: serialize_prefilter_items(mutation_output.items),
        translation_extras: mutation_output.translation_extras,
        project_status: mutation_output.project_status,
        prefilter_config: mutation_output.prefilter_config,
        expected_section_revisions: {
          items: args.state.revisions.sections.items ?? 0,
          analysis: args.state.revisions.sections.analysis ?? 0,
        },
      }),
    );
    args.align_project_runtime_ack(mutation_ack);
    return mutation_output;
  } catch (error) {
    local_commit.rollback();
    void args.refresh_project_runtime().catch(() => {});
    throw error;
  }
}
