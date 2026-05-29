import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectWriteCommitter,
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";

type BasicSettingsSectionRevisions = Record<string, number | undefined>;

type BasicSettingsRevisionsResponse = {
  sectionRevisions?: BasicSettingsSectionRevisions;
};

type ApplyBasicSettingsPrefilterWriteArgs = {
  source_language: string;
  target_language: string;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
  commit_project_write: ProjectWriteCommitter;
};

// 基础设置页拥有自己的预过滤 write 诊断名，避免 desktop state 反向登记页面业务词表。
const BASIC_SETTINGS_PREFILTER_WRITE: ProjectWriteOperation = "basic-settings.prefilter_settings";

async function read_basic_settings_section_revisions(): Promise<BasicSettingsSectionRevisions> {
  const response = await api_fetch<BasicSettingsRevisionsResponse>("/api/workbench/view", {});
  return response.sectionRevisions ?? {};
}

// 基础设置页的预过滤提交只包装本页所需 API 请求。
export async function apply_basic_settings_prefilter_write(
  args: ApplyBasicSettingsPrefilterWriteArgs,
): Promise<void> {
  const section_revisions = await read_basic_settings_section_revisions();
  await args.commit_project_write({
    operation: BASIC_SETTINGS_PREFILTER_WRITE,
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
