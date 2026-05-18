import { api_fetch } from "@/app/desktop/desktop-api";
import {
  normalize_project_mutation_result,
  type ProjectMutationResult,
  type ProjectMutationResultPayload,
} from "@/app/desktop/desktop-runtime-context";
import type { ProjectStoreState } from "@/project/store/project-store";

type ApplyProjectPrefilterMutationArgs = {
  state: ProjectStoreState; // 当前 ProjectStore 镜像，只读取 revision 锁
  source_language: string; // 后端预过滤使用的源语言
  target_language: string; // 后端写入设置镜像的目标语言
  mtool_optimizer_enable: boolean; // 后端 KVJSON 预过滤开关
  skip_duplicate_source_text_enable: boolean; // 后端重复原文预过滤开关
  apply_project_mutation_result: (result: ProjectMutationResult) => Promise<void>; // 应用后端 canonical changes
  refresh_project_runtime: () => Promise<void>; // mutation 失败后刷新后端权威运行态
};

// 设置触发的预过滤只提交命令，items 与派生 meta 由后端重算。
export async function apply_project_prefilter_mutation(
  args: ApplyProjectPrefilterMutationArgs,
): Promise<void> {
  try {
    const mutation_result = normalize_project_mutation_result(
      await api_fetch<ProjectMutationResultPayload>("/api/project/settings-alignment/apply", {
        mode: "prefiltered_items",
        project_settings: {
          source_language: args.source_language,
          target_language: args.target_language,
          mtool_optimizer_enable: args.mtool_optimizer_enable,
          skip_duplicate_source_text_enable: args.skip_duplicate_source_text_enable,
        },
        expected_section_revisions: {
          items: args.state.revisions.sections.items ?? 0,
          analysis: args.state.revisions.sections.analysis ?? 0,
        },
      }),
    );
    await args.apply_project_mutation_result(mutation_result);
  } catch (error) {
    void args.refresh_project_runtime().catch(() => {});
    throw error;
  }
}
