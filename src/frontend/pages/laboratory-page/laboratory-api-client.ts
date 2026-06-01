import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectWriteCommitter,
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";

type LaboratorySectionRevisions = Record<string, number | undefined>;

type LaboratoryRevisionsResponse = {
  sectionRevisions?: LaboratorySectionRevisions;
};

type ApplyLaboratoryPrefilterWriteArgs = {
  source_language: string;
  target_language: string;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
  commit_project_write: ProjectWriteCommitter;
};

// 实验室页拥有自己的预过滤写入诊断名，desktop state 只接收显式 operation。
const LABORATORY_PREFILTER_WRITE: ProjectWriteOperation = "laboratory.prefilter_settings";

async function read_laboratory_section_revisions(): Promise<LaboratorySectionRevisions> {
  const response = await api_fetch<LaboratoryRevisionsResponse>("/api/workbench/snapshot", {});
  return response.sectionRevisions ?? {};
}

// 实验室页的预过滤提交只包装本页所需 API 请求。
export async function apply_laboratory_prefilter_write(
  args: ApplyLaboratoryPrefilterWriteArgs,
): Promise<void> {
  const section_revisions = await read_laboratory_section_revisions();
  await args.commit_project_write({
    operation: LABORATORY_PREFILTER_WRITE,
    run: async () => {
      return await api_fetch<ProjectWriteResultPayload>("/api/workbench/settings-alignment/apply", {
        mode: "prefiltered_items",
        project_settings: {
          source_language: args.source_language,
          target_language: args.target_language,
          mtool_optimizer_enable: args.mtool_optimizer_enable,
          skip_duplicate_source_text_enable: args.skip_duplicate_source_text_enable,
        },
        expected_section_revisions: {
          items: section_revisions.items ?? 0,
          analysis: section_revisions.analysis ?? 0,
        },
      });
    },
  });
}
