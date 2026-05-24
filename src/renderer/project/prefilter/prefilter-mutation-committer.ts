import { api_fetch } from "@/app/desktop/desktop-api";
import {
  type ProjectMutationCommitter,
  type ProjectMutationOperation,
  type ProjectMutationResultPayload,
} from "@/app/desktop/desktop-project-mutation";
import type { ProjectStoreState } from "@/project/store/project-store";

type ApplyProjectPrefilterMutationArgs = {
  state: ProjectStoreState; // 当前 ProjectStore 镜像，只读取 revision 锁
  source_language: string; // 后端预过滤使用的源语言
  target_language: string; // 后端写入设置镜像的目标语言
  mtool_optimizer_enable: boolean; // 后端 KVJSON 预过滤开关
  skip_duplicate_source_text_enable: boolean; // 后端重复原文预过滤开关
  commit_project_mutation: ProjectMutationCommitter; // 统一 mutation 管线负责提交、回灌和失败恢复
  operation: ProjectMutationOperation; // operation 标记触发预过滤的页面业务动作
};

// 设置触发的预过滤只提交命令，items 与派生 meta 由后端重算。
export async function apply_project_prefilter_mutation(
  args: ApplyProjectPrefilterMutationArgs,
): Promise<void> {
  await args.commit_project_mutation({
    operation: args.operation,
    run: async () => {
      return await api_fetch<ProjectMutationResultPayload>(
        "/api/project/settings-alignment/apply",
        {
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
        },
      );
    },
  });
}
