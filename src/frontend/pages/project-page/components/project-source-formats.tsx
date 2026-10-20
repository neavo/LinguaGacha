import { useId, type JSX } from "react";

import { useI18n } from "@frontend/app/locale/locale-context";
import { Badge } from "@frontend/shadcn/badge";
import { badgeVariants } from "@frontend/shadcn/badge-variants";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import {
  PROJECT_SOURCE_FORMATS,
  type ProjectSourceFormatHitCounts,
} from "@shared/project-source-formats";

/** 按支持状态依次展示分组，组内沿用格式目录顺序。 */
const FORMAT_GROUPS = [
  { support_status: "supported", title_key: "project_page.formats.title" },
  { support_status: "deprecated", title_key: "project_page.formats.deprecated_title" },
] as const;

type ProjectSourceFormatsProps = {
  format_hit_counts?: ProjectSourceFormatHitCounts | undefined; // 尚未选择来源时没有摘要
};

/** 展示来源格式及后端摘要中的命中数。 */
export function ProjectSourceFormats(props: ProjectSourceFormatsProps): JSX.Element {
  const { t } = useI18n();
  const id_prefix = useId(); // 为每个实例的分组标题生成独立 ID，供列表关联。

  return (
    <div className="project-home__panel-section project-home__formats">
      {FORMAT_GROUPS.map((group) => {
        const title_id = `${id_prefix}-${group.support_status}`;
        return (
          <section key={group.support_status} className="project-home__format-group">
            <h3 id={title_id} className="project-home__section-title">
              {t(group.title_key)}
            </h3>
            <ul aria-labelledby={title_id} className="project-home__format-tags">
              {PROJECT_SOURCE_FORMATS.filter(
                (format) => format.support_status === group.support_status,
              ).map((format) => {
                const hit_count = props.format_hit_counts?.[format.id] ?? 0;
                return (
                  <Tooltip key={format.id}>
                    <TooltipTrigger
                      render={
                        <li
                          className={badgeVariants({
                            className: "project-home__format-tag",
                          })}
                        >
                          <span className="project-home__format-title">{t(format.title_key)}</span>
                          <span className="project-home__format-extension">{format.extension}</span>
                          {hit_count > 0 ? <Badge tone="brand">{hit_count}</Badge> : null}
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
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
