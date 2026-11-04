import { useId, type JSX } from "react";
import { Lightbulb } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { badgeVariants } from "@frontend/shadcn/badge-variants";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { ProjectLanguageDialog } from "@frontend/features/project-language/project-language-dialog";
import { PROJECT_SOURCE_FORMATS } from "@shared/project-source-formats";
import type { useProjectCreateFlow } from "./use-project-create-flow";
import "./project-lifecycle.css";

/** 按支持状态依次展示分组，组内沿用格式目录顺序。`internal` 格式不展示。 */
const FORMAT_GROUPS = [
  { support_status: "supported", title_key: "project.formats.title" },
  { support_status: "deprecated", title_key: "project.formats.deprecated_title" },
] as const;

/** 创建前展示格式说明，倒计时留出阅读时间。语言确认保持父子关系，关闭后恢复创建焦点。 */
export function ProjectCreateDialog(props: {
  flow: ReturnType<typeof useProjectCreateFlow>;
}): JSX.Element {
  const { t } = useI18n();
  const flow = props.flow;
  const id_prefix = useId(); // 分组标题 ID 供列表关联

  return (
    <AppPageDialog
      open={flow.open}
      title={t("project.create.title")}
      onClose={flow.close}
      submitting={flow.is_creating_project}
      bodyClassName="project-lifecycle gap-[18px]"
      primaryAction={{
        label: t("project.create.action"),
        shortcut: "submit",
        delayed: true,
        onSelect: flow.open_language_dialog,
      }}
    >
      {FORMAT_GROUPS.map((group) => {
        const title_id = `${id_prefix}-${group.support_status}`;
        return (
          <section key={group.support_status} className="project-lifecycle__format-group">
            <h3 id={title_id} className="project-lifecycle__section-title">
              {t(group.title_key)}
            </h3>
            <ul aria-labelledby={title_id} className="project-lifecycle__format-tags">
              {PROJECT_SOURCE_FORMATS.filter(
                (format) => format.support_status === group.support_status,
              ).map((format) => (
                <Tooltip key={format.id}>
                  <TooltipTrigger
                    render={
                      <li className={badgeVariants({ className: "project-lifecycle__format-tag" })}>
                        <span>{t(format.title_key)}</span>
                        <span className="project-lifecycle__format-extension">
                          {format.extension}
                        </span>
                      </li>
                    }
                  />
                  <TooltipContent className="flex-col items-start gap-1">
                    {(format.description_keys.length > 0
                      ? format.description_keys
                      : [format.title_key]
                    ).map((description_key) => (
                      <span key={description_key}>{t(description_key)}</span>
                    ))}
                  </TooltipContent>
                </Tooltip>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="project-lifecycle__notice">
        <Lightbulb aria-hidden="true" />
        {t("project.formats.any_format_notice")}
      </p>
      <ProjectLanguageDialog
        open={flow.is_language_dialog_open}
        languages={flow.create_languages}
        on_change={(field, value) =>
          flow.set_create_languages((previous) => ({ ...previous, [field]: value }))
        }
        on_confirm={flow.confirm_language_dialog}
        on_close={() => flow.set_is_language_dialog_open(false)}
      />
    </AppPageDialog>
  );
}
