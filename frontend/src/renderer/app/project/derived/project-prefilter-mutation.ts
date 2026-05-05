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
import {
  run_project_prefilter,
  serialize_prefilter_runtime_items,
} from "@/app/project/derived/project-prefilter-runner";

type ApplyProjectPrefilterMutationArgs = {
  state: ProjectStoreState;
  source_language: string;
  target_language: string;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
  compute_prefilter: (
    input: ProjectPrefilterMutationInput,
  ) => Promise<ProjectPrefilterMutationOutput>;
  commit_local_project_patch: (input: LocalProjectPatchInput) => LocalProjectPatchCommit;
  align_project_runtime_ack: (ack: ProjectMutationAck) => void;
  refresh_project_runtime: () => Promise<void>;
};

export async function apply_project_prefilter_mutation(
  args: ApplyProjectPrefilterMutationArgs,
): Promise<ProjectPrefilterMutationOutput> {
  const mutation_output = await run_project_prefilter({
    state: args.state,
    settings: {
      source_language: args.source_language,
      target_language: args.target_language,
      mtool_optimizer_enable: args.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: args.skip_duplicate_source_text_enable,
    },
    executor: args.compute_prefilter,
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
      await api_fetch<ProjectMutationAckPayload>("/api/project/settings-alignment/apply", {
        mode: "prefiltered_items",
        items: serialize_prefilter_runtime_items(mutation_output.items),
        translation_extras: mutation_output.translation_extras,
        prefilter_config: mutation_output.prefilter_config,
        project_settings: mutation_output.project_settings,
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
