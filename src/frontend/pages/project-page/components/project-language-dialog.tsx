import type { JSX } from "react";

import type { ProjectLanguageKey } from "@domain/project-settings";
import { useI18n } from "@frontend/app/locale/locale-context";
import { ProjectLanguageSelect } from "@frontend/features/project-language/project-language-select";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

type ProjectLanguageDialogProps = {
  open: boolean;
  languages: Record<ProjectLanguageKey, string>; // 项目页持有的本次新建草稿
  on_change: (field: ProjectLanguageKey, next_value: string) => void;
  on_confirm: () => void;
  on_close: () => void;
};

/** 新建工程前选择源语言与目标语言，确认后由项目页继续保存路径与创建流程。 */
export function ProjectLanguageDialog(props: ProjectLanguageDialogProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AppPageDialog
      open={props.open}
      title={t("project_page.create.language_dialog_title")}
      size="sm"
      onClose={props.on_close}
      primaryAction={{
        label: t("app.action.confirm"),
        shortcut: "submit",
        onSelect: props.on_confirm,
      }}
    >
      <div className="project-home__language-list">
        <SettingCardRow
          variant="group"
          action_width="content"
          title={t("app.language_role.source")}
          description={t("basic_settings_page.fields.source_language.description")}
          action={
            <ProjectLanguageSelect
              field="source_language"
              value={props.languages.source_language}
              on_change={(next_value) => {
                props.on_change("source_language", next_value);
              }}
            />
          }
        />
        <SettingCardRow
          variant="group"
          action_width="content"
          title={t("app.language_role.target")}
          description={t("basic_settings_page.fields.target_language.description")}
          action={
            <ProjectLanguageSelect
              field="target_language"
              value={props.languages.target_language}
              on_change={(next_value) => {
                props.on_change("target_language", next_value);
              }}
            />
          }
        />
      </div>
    </AppPageDialog>
  );
}
