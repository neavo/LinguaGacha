import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { SettingsSnapshot } from "@frontend/app/state/desktop-state-context";
import type {
  ProjectWriteCommitter,
  ProjectWriteOperation,
  ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";

type PrefilterSettings = Pick<
  SettingsSnapshot,
  | "source_language"
  | "target_language"
  | "mtool_optimizer_enable"
  | "skip_duplicate_source_text_enable"
>;

export async function apply_prefilter_settings_write(args: {
  operation: ProjectWriteOperation;
  settings: PrefilterSettings;
  commit_project_write: ProjectWriteCommitter;
}): Promise<void> {
  const snapshot = await api_fetch<{ sectionRevisions?: Record<string, number | undefined> }>(
    "/api/workbench/snapshot",
    {},
  );
  await args.commit_project_write({
    operation: args.operation,
    run: async () => {
      return await api_fetch<ProjectWriteResultPayload>("/api/workbench/settings-alignment/apply", {
        mode: "prefiltered_items",
        project_settings: args.settings,
        expected_section_revisions: {
          items: snapshot.sectionRevisions?.items ?? 0,
        },
      });
    },
  });
}
