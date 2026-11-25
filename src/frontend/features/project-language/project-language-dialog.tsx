import type { JSX } from "react";
import {
  ALL_LANGUAGE_CODE,
  SOURCE_LANGUAGE_CODES,
  TARGET_LANGUAGE_CODES,
  type LanguageCode,
} from "@domain/language";
import type { ProjectLanguageSettings } from "@domain/project-settings";
import { get_language_label_key } from "@frontend/app/locale/language-label";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frontend/shadcn/select";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

const PROJECT_SOURCE_LANGUAGES = [ALL_LANGUAGE_CODE, ...SOURCE_LANGUAGE_CODES] as const;

type ProjectLanguageDialogProps = {
  title?: string | undefined;
  languages: ProjectLanguageSettings;
  disabled?: boolean;
  submitting?: boolean;
  on_change: (languages: ProjectLanguageSettings) => void;
  on_confirm: () => void | Promise<void>;
  on_close: () => void;
};

/** 新建和编辑共用语言选项。调用方持有本次草稿，确认后决定如何保存。 */
export function ProjectLanguageDialog(props: ProjectLanguageDialogProps): JSX.Element {
  const { t } = useI18n();
  const disabled = props.disabled === true || props.submitting === true;
  return (
    <AppPageDialog
      open
      title={props.title ?? t("project.language.title")}
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
        <ProjectLanguageRow
          label="app.language_role.source"
          description="project.language.source_description"
          codes={PROJECT_SOURCE_LANGUAGES}
          value={props.languages.source_language}
          disabled={disabled}
          on_change={(source_language) => props.on_change({ ...props.languages, source_language })}
        />
        <ProjectLanguageRow
          label="app.language_role.target"
          description="project.language.target_description"
          codes={TARGET_LANGUAGE_CODES}
          value={props.languages.target_language}
          disabled={disabled}
          on_change={(target_language) => props.on_change({ ...props.languages, target_language })}
        />
      </div>
    </AppPageDialog>
  );
}

/** 下拉选项与回调使用同一组语言码，源语言和目标语言各自保持值域。 */
function ProjectLanguageRow<Code extends LanguageCode>(props: {
  label: LocaleKey;
  description: LocaleKey;
  codes: readonly Code[];
  value: NoInfer<Code>;
  disabled: boolean;
  on_change: (value: NoInfer<Code>) => void;
}): JSX.Element {
  const { t } = useI18n();
  const title = t(props.label);
  const options = props.codes.map((value) => ({ value, label: t(get_language_label_key(value)) }));
  return (
    <SettingCardRow
      variant="group"
      action_width="content"
      title={title}
      description={t(props.description)}
      action={
        <Select<Code>
          items={options}
          value={props.value}
          disabled={props.disabled}
          onValueChange={(value) => {
            if (value !== null) props.on_change(value);
          }}
        >
          <SelectTrigger aria-label={title}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      }
    />
  );
}
