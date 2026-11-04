import type { JSX } from "react";

import type { ProjectLanguageKey } from "@domain/project-settings";
import { useI18n } from "@frontend/app/locale/locale-context";
import { ProjectLanguageSelect } from "@frontend/features/project-language/project-language-select";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

type ProjectLanguageDialogProps = {
  open: boolean;
  languages: Record<ProjectLanguageKey, string>; // 调用方持有本次编辑草稿
  disabled?: boolean;
  submitting?: boolean;
  on_change: (field: ProjectLanguageKey, next_value: string) => void;
  on_confirm: () => void | Promise<void>;
  on_close: () => void;
};

/** 新建与编辑工程共用语言选择，调用方负责草稿和确认后的业务流程。 */
export function ProjectLanguageDialog(props: ProjectLanguageDialogProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AppPageDialog
      open={props.open}
      title={t("project.language.title")}
      size="sm"
      onClose={props.on_close}
      submitting={props.submitting === true}
      primaryAction={{
        label: t("app.action.confirm"),
        shortcut: "submit",
        onSelect: props.on_confirm,
        disabled: props.disabled === true,
      }}
    >
      <div className="flex flex-col gap-(--ui-list-gap-dense)">
        <SettingCardRow
          variant="group"
          action_width="content"
          title={t("app.language_role.source")}
          description={t("project.language.source_description")}
          action={
            <ProjectLanguageSelect
              disabled={props.disabled === true || props.submitting === true}
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
          description={t("project.language.target_description")}
          action={
            <ProjectLanguageSelect
              disabled={props.disabled === true || props.submitting === true}
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
