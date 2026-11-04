import type { JSX } from "react";
import type { ProjectPreview } from "@shared/project-preview";
import { useI18n } from "@frontend/app/locale/locale-context";
import { format_local_timestamp } from "@shared/utils/format-local-timestamp";
import { Badge } from "@frontend/shadcn/badge";
import "./project-lifecycle.css";
/** 悬停摘要只展示数值，避免提示中再嵌套提示。 */
export function ProjectPreviewSummary(props: { preview: ProjectPreview }): JSX.Element {
  const { t } = useI18n();
  const preview = props.preview;
  return (
    <div className="project-lifecycle__preview-panel">
      <dl className="project-lifecycle__preview-list">
        <div className="project-lifecycle__preview-row">
          <dt className="project-lifecycle__preview-label">{t("project.preview.file_count")}</dt>
          <dd className="project-lifecycle__preview-value">
            <Badge tone="brand">
              {t("project.preview.files", { COUNT: String(preview.file_paths.length) })}
            </Badge>
          </dd>
        </div>
        {(
          [
            ["created_at", preview.created_at],
            ["updated_at", preview.updated_at],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="project-lifecycle__preview-row">
            <dt className="project-lifecycle__preview-label">{t(`project.preview.${key}`)}</dt>
            <dd className="project-lifecycle__preview-value tabular-nums">
              {format_local_timestamp(value) ?? "—"}
            </dd>
          </div>
        ))}
        <div className="project-lifecycle__preview-row">
          <dt className="project-lifecycle__preview-label">{t("project.preview.progress")}</dt>
          <dd className="project-lifecycle__preview-value">
            <Badge
              tone={preview.translation_stats.completion_percent === 100 ? "success" : "neutral"}
            >
              {preview.translation_stats.completion_percent.toFixed(2)}%
            </Badge>
          </dd>
        </div>
      </dl>
    </div>
  );
}
