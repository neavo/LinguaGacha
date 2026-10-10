import type { JsonRecord } from "../../domain/json";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type { ProjectPrompts } from "../../domain/prompt";
import type { QualityRuleBlock } from "../../shared/quality/quality-rule-state";
import type { QualityStatisticsTextChangeScope } from "../../shared/project-event";
import type { ProjectDataSection, ProjectDataSectionRevisions } from "../../shared/project-event";
import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectFileRecord } from "./project-file-records";
import { ProjectDataReader } from "./project-data-reader";

/** 事务准备阶段提供实际变化范围。 */
export type ProjectWriteChangeRequest = {
  projectPath: string;
  source: string; // 诊断来源，不参与缓存失效判断。
  updatedSections: ProjectDataSection[];
  changedItemIds?: number[]; // 省略表示完整替换。
  qualityStatisticsScope: QualityStatisticsTextChangeScope; // 事务内的实际文本影响，来源只用于诊断。
};

/** 缓存消费的唯一规范条目事实。 */
export type ProjectCommittedItems = Readonly<{
  mode: "full" | "delta";
  records: readonly ProjectItemPublicRecord[]; // 单次事务后的规范行，后端消费者共享同一事实。
}>;

/** 单次事务形成的事实快照，提交后供缓存、通知与回执共同消费。 */
export type ProjectCommittedChange = Readonly<{
  projectPath: string;
  source: string; // 诊断来源，不参与缓存失效判断。
  updatedSections: ProjectDataSection[];
  sectionRevisions: ProjectDataSectionRevisions;
  qualityStatisticsScope: QualityStatisticsTextChangeScope;
  items?: ProjectCommittedItems;
  files?: Record<string, ProjectFileRecord>;
  quality?: QualityRuleBlock;
  prompts?: ProjectPrompts;
}>;

/** 提交后同步缓存，异常由写入口报告已提交状态。 */
export type ProjectCommittedChangeHandler = (
  change: ProjectCommittedChange,
) => void | Promise<void>;

/** 在写入事务内读取规范事实，异常仍可回滚。 */
export function build_project_committed_change(
  database: ProjectDatabase,
  request: ProjectWriteChangeRequest,
  meta: JsonRecord,
  replacementItems?: ProjectItemPublicRecord[],
  fileMetadata?: Pick<ProjectItemPublicRecord, "file_path" | "file_type">[],
): ProjectCommittedChange {
  const reader = new ProjectDataReader(database);
  const project = request.projectPath;
  const affected = new Set(request.updatedSections);
  const items: ProjectCommittedItems | undefined = !affected.has("items")
    ? undefined
    : request.changedItemIds === undefined
      ? {
          mode: "full",
          records: replacementItems ?? reader.build_runtime_items_snapshot(project).item_records,
        }
      : {
          mode: "delta",
          records: reader.build_item_records_by_ids(project, request.changedItemIds),
        };
  return {
    projectPath: project,
    source: request.source,
    updatedSections: request.updatedSections,
    sectionRevisions: reader.build_section_revisions(meta),
    qualityStatisticsScope:
      affected.has("quality") || items?.mode === "full" ? "all" : request.qualityStatisticsScope,
    ...(items === undefined ? {} : { items }),
    ...(affected.has("files") || items?.mode === "full"
      ? {
          files: reader.build_files_record_block(
            project,
            items?.mode === "full" ? items.records : fileMetadata,
          ),
        }
      : {}),
    ...(affected.has("quality") ? { quality: reader.build_quality_block(project, meta) } : {}),
    ...(affected.has("prompts") ? { prompts: reader.build_prompts_block(project, meta) } : {}),
  };
}
