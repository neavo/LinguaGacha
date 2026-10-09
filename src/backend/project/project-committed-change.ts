import type { JsonRecord, JsonValue } from "../../domain/json";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type { ProjectPrompts } from "../../domain/prompt";
import type { QualityRuleBlock } from "../../shared/quality/quality-rule-state";
import type {
  ProjectChangeItemsPayload,
  ProjectChangeSectionPayload,
  ProjectDataSection,
  ProjectDataSectionRevisions,
} from "../../shared/project-event";
import type { ProjectDatabase } from "../database/database-operations";
import { ProjectDataReader } from "./project-data-reader";
/** 事务准备阶段只提供实际变化范围，公开载荷由已提交事实生成。 */
export type ProjectWriteChangeRequest = {
  projectPath: string;
  source: string;
  updatedSections: ProjectDataSection[];
  changedItemIds?: number[]; // 省略表示受影响的条目分区需要全量替换。
};

/** 当前写入口只产生完整替换或规范行增量。 */
export type ProjectCommittedItems =
  | { payloadMode: "section-invalidated" }
  | {
      payloadMode: "canonical-delta";
      changedIds: number[];
      upsert: NonNullable<ProjectChangeItemsPayload["upsert"]>;
    };

/** 单次事务形成的事实快照，提交后供缓存、公开通知与回执共同消费。 */
export type ProjectCommittedChange = Readonly<{
  projectPath: string;
  source: string;
  updatedSections: ProjectDataSection[];
  sectionRevisions: ProjectDataSectionRevisions;
  items?: ProjectCommittedItems;
  files?: { payloadMode: "section-invalidated" };
  sections: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>>;
  itemRecords?: ProjectItemPublicRecord[];
  fileRecords?: JsonRecord;
  quality?: QualityRuleBlock;
  prompts?: ProjectPrompts;
}>;
/** 提交成功后同步后端缓存，失败由业务写入口报告。 */
export type ProjectCommittedChangeHandler = (
  change: ProjectCommittedChange,
) => void | Promise<void>;

/** 在写入事务内读取变化后的规范事实，异常仍可回滚。 */
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
  const sectionRevisions = reader.build_section_revisions(meta); // 同一快照供分区数据与提交回执共用。
  const itemRecords = !affected.has("items")
    ? undefined
    : request.changedItemIds === undefined
      ? (replacementItems ?? reader.build_runtime_items_snapshot(project).item_records)
      : reader.build_item_records_by_ids(project, request.changedItemIds);
  const items: ProjectCommittedItems | undefined =
    itemRecords === undefined
      ? undefined
      : request.changedItemIds === undefined
        ? { payloadMode: "section-invalidated" }
        : {
            payloadMode: "canonical-delta",
            changedIds: request.changedItemIds,
            upsert: Object.fromEntries(itemRecords.map((item) => [item.item_id, item])),
          };
  const fileRecords =
    affected.has("files") || items?.payloadMode === "section-invalidated"
      ? reader.build_files_record_block(
          project,
          items?.payloadMode === "section-invalidated" ? itemRecords : fileMetadata,
        )
      : undefined;
  const quality = affected.has("quality") ? reader.build_quality_block(project, meta) : undefined;
  const prompts = affected.has("prompts") ? reader.build_prompts_block(project, meta) : undefined;
  const data: Partial<Record<ProjectDataSection, JsonValue | undefined>> = {
    project: { path: project, loaded: true },
    quality,
    prompts,
    proofreading: { revision: sectionRevisions.proofreading },
    ...(affected.has("pdf") ? { pdf: database.read_pdf_summaries(project) } : {}),
  };
  const sections: ProjectCommittedChange["sections"] = {};
  for (const section of request.updatedSections) {
    if (section === "items" || section === "files") continue;
    sections[section] = { payloadMode: "canonical-delta", data: data[section] ?? {} };
  }
  return {
    projectPath: project,
    source: request.source,
    updatedSections: request.updatedSections,
    sectionRevisions,
    sections,
    ...(items === undefined ? {} : { items }),
    ...(affected.has("files") ? { files: { payloadMode: "section-invalidated" as const } } : {}),
    ...(itemRecords === undefined ? {} : { itemRecords }),
    ...(fileRecords === undefined ? {} : { fileRecords }),
    ...(quality === undefined ? {} : { quality }),
    ...(prompts === undefined ? {} : { prompts }),
  };
}
