import { ProjectDatabase, type ProjectDatabaseWrite } from "../database/database-operations";
import {
  is_json_record,
  read_json_integer,
  read_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";
import { is_task_progress_status } from "../../domain/task";
import { count_analysis_glossary_candidates } from "../../shared/analysis-candidate";
import type {
  ProjectChangeFilesPayload,
  ProjectChangeItemFieldPatch,
  ProjectChangeItemsPayload,
  ProjectChangePayloadMode,
  ProjectDataSection,
  ProjectDataSectionRevisions,
  ProjectWriteResult,
} from "../../shared/project-event";
import * as AppErrors from "../../shared/error";
import { build_project_item_field_patch } from "../../shared/project/project-item-field-patch";
import type { ProjectItemWriteFields } from "../../shared/project/project-item-field-patch";
import { create_quality_rule_entry_id } from "../../shared/quality/quality-rule-entry";
import { build_section_revisions_from_meta, get_section_revision } from "./project-data-reader";
import {
  build_analysis_section_delta,
  create_empty_translation_task_snapshot,
} from "./project-write-state";
import type {
  ProjectChangePublisher,
  ProjectWriteChangeRequest,
} from "./project-write-event-adapter";
import type { ProjectExpectedSectionRevisions } from "./project-write-request";
import type {
  AnalysisCheckpointWrite,
  AnalysisGlossaryWrite,
  AnalysisProgressWrite,
  ProjectItemWriteChange,
  TranslationItemPatch,
} from "./project-write-request";
import {
  resolve_project_prompt_storage,
  resolve_project_quality_rule_storage,
  type ProjectTaskInput,
} from "./project-task-input";
import type { ProjectEvent, ProjectEventHandler } from "./project-events";
import {
  resolve_agent_workspace_writes,
  has_agent_workspace_applied_changes,
  type AgentWorkspaceIntentBatch,
  type AgentWorkspaceRejectedChange,
  type AgentWorkspaceAppliedSummary,
} from "./agent-workspace-write";
import type { PromptKind } from "../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";

type RevisionBackedSection = "files" | "items" | "analysis" | "proofreading";
type ProjectWriteRevisionContext = {
  project_path: string;
  meta: MutableJsonRecord;
  sections: ProjectDataSection[];
};

/**
 * ProjectAssetWrite 表示工作台结构性写入中的 asset 操作。
 */
export type ProjectAssetWrite =
  | {
      kind: "add_from_source";
      path: string;
      sourcePath: string;
      sortOrder: number;
    }
  | {
      kind: "update_from_source";
      path: string;
      sourcePath: string;
    }
  | {
      kind: "delete";
      path: string;
    };

type RuntimeCommitRequest = {
  projectPath: string;
  expectedSectionRevisions?: ProjectExpectedSectionRevisions;
  requireExpectedSectionRevisions: boolean; // 快照派生写入校验 revision，当前事实命令只读取事务内快照
  revisionSections: ProjectDataSection[];
  source: string;
  updatedSections: ProjectDataSection[];
  buildWrites: (context: ProjectWriteRevisionContext) => ProjectDatabaseWrite[];
  items?: Pick<
    ProjectChangeItemsPayload,
    "payloadMode" | "changedIds" | "deleteIds" | "fieldPatch"
  >;
  files?: Pick<ProjectChangeFilesPayload, "payloadMode" | "changedPaths" | "deletePaths">;
  sections?: Partial<
    Record<ProjectDataSection, { payloadMode: ProjectChangePayloadMode; data?: JsonValue }>
  >;
  sectionModes?: Partial<Record<ProjectDataSection, ProjectChangePayloadMode>>;
};

type RuntimeCommitOptions = {
  publishPublic?: boolean;
};

/**
 * ProjectWriteSectionAck 是任务 artifact 写入后回传给 engine 的 revision 确认。
 */
export type ProjectWriteSectionAck = {
  changed_item_ids: number[];
  section_revisions: MutableJsonRecord;
};

type TranslationProgressCounters = {
  total_line: number;
  processed_line: number;
  error_line: number;
  line: number;
};

/**
 * loaded project 运行态事实的唯一语义写入口。
 */
export class ProjectWriteStore {
  private readonly database: ProjectDatabase; // workflow 是项目事实的物理写入边界

  private readonly project_event_handler: ProjectEventHandler; // 提交后先维护内部 cache 事实

  private readonly project_change_publisher: ProjectChangePublisher | null; // 内部事件成功后再生成公开变更

  /**
   * 注入唯一数据库写入口、内部 cache 事件处理器和可选公开变更发布器。
   */
  public constructor(
    database: ProjectDatabase,
    project_event_handler: ProjectEventHandler,
    project_change_publisher: ProjectChangePublisher | null,
  ) {
    this.database = database;
    this.project_event_handler = project_event_handler;
    this.project_change_publisher = project_change_publisher;
  }

  /**
   * 普通翻译 artifact 只按 item_id 局部更新译文字段。
   */
  public async apply_translation_item_patches(request: {
    projectPath: string;
    items: TranslationItemPatch[];
    translationExtras: MutableJsonRecord;
  }): Promise<ProjectWriteSectionAck> {
    return await this.apply_task_item_patches({
      projectPath: request.projectPath,
      items: request.items,
      translationExtras: request.translationExtras,
      source: "translation_batch_update",
      updatedSections: ["items"],
    });
  }

  /**
   * 重翻 artifact 同步推进 proofreading revision，并返回剩余行级任务范围。
   */
  public async apply_retranslation_item_patches(request: {
    projectPath: string;
    items: TranslationItemPatch[];
    translationExtras: MutableJsonRecord;
  }): Promise<ProjectWriteSectionAck> {
    return await this.apply_task_item_patches({
      projectPath: request.projectPath,
      items: request.items,
      translationExtras: request.translationExtras,
      source: "retranslate_items",
      updatedSections: ["items", "proofreading"],
    });
  }

  /**
   * 任务进度 meta 仍经由运行态写入口提交，避免任务层直接碰数据库 workflow。
   */
  public update_task_progress_meta(request: {
    projectPath: string;
    meta: MutableJsonRecord;
  }): void {
    this.database.upsert_meta_entries(request.projectPath, request.meta as unknown as JsonRecord);
  }

  /**
   * 分析 artifact 写入 checkpoint、候选聚合和进度，并发布轻量 analysis 增量。
   */
  public async commit_analysis_artifacts(request: {
    projectPath: string;
    successCheckpoints: AnalysisCheckpointWrite[];
    errorCheckpoints: AnalysisCheckpointWrite[];
    glossaryEntries: AnalysisGlossaryWrite[];
    progressSnapshot: AnalysisProgressWrite | null;
  }): Promise<MutableJsonRecord> {
    const project_path = request.projectPath;
    const success_checkpoints = request.successCheckpoints;
    const error_checkpoints = this.build_error_checkpoint_rows(
      project_path,
      request.errorCheckpoints,
    );
    const glossary_entries = request.glossaryEntries;
    const progress_snapshot: MutableJsonRecord | null =
      request.progressSnapshot === null ? null : { ...request.progressSnapshot };
    const meta = this.read_project_meta(project_path);
    const candidate_result = this.build_next_candidate_rows(
      project_path,
      glossary_entries,
      read_json_integer(meta["analysis_candidate_count"], 0),
    );
    await this.commit_runtime_change({
      projectPath: project_path,
      requireExpectedSectionRevisions: false,
      revisionSections: ["analysis"],
      source: "analysis_batch_update",
      updatedSections: ["analysis"],
      sections: {
        analysis: {
          payloadMode: "canonical-delta",
          data: build_analysis_section_delta(
            progress_snapshot ?? {
              ...read_json_record(meta["analysis_extras"]),
            },
            candidate_result.count,
          ) as unknown as JsonValue,
        },
      },
      buildWrites: (revision_context) => {
        const writes: ProjectDatabaseWrite[] = [];
        if (success_checkpoints.length > 0 || error_checkpoints.length > 0) {
          writes.push((database) =>
            database.upsert_analysis_item_checkpoints(project_path, [
              ...success_checkpoints,
              ...error_checkpoints,
            ] as unknown as JsonValue[]),
          );
        }
        if (candidate_result.rows.length > 0) {
          writes.push((database) =>
            database.upsert_analysis_candidate_aggregates(
              project_path,
              candidate_result.rows as unknown as JsonValue[],
            ),
          );
        }
        writes.push(
          (database) =>
            database.upsert_meta_entries(project_path, {
              ...(progress_snapshot === null ? {} : { analysis_extras: progress_snapshot }),
              analysis_candidate_count: candidate_result.count,
            } as unknown as JsonRecord),
          ...this.build_section_revision_writes(revision_context),
        );
        return writes;
      },
    });
    return {
      inserted_count: glossary_entries.length,
      analysis_candidate_count: candidate_result.count,
      section_revisions: this.build_section_revisions(project_path, ["analysis"]),
    };
  }

  /**
   * 分析状态重置统一清理 checkpoint、候选与 progress meta。
   */
  public async reset_analysis_state(request: {
    projectPath: string;
    expectedSectionRevisions?: ProjectExpectedSectionRevisions;
    requireExpectedSectionRevisions: boolean;
    source: string;
    mode: "all" | "failed";
    analysisExtras: MutableJsonRecord;
    analysisCandidateCount?: number;
    sectionData?: MutableJsonRecord;
  }): Promise<ProjectWriteResult> {
    const meta: MutableJsonRecord = {
      analysis_extras: request.analysisExtras as unknown as JsonValue,
    };
    if (request.analysisCandidateCount !== undefined) {
      meta["analysis_candidate_count"] = Math.max(0, Math.trunc(request.analysisCandidateCount));
    }
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: request.requireExpectedSectionRevisions,
      revisionSections: ["analysis"],
      source: request.source,
      updatedSections: ["analysis"],
      sections:
        request.sectionData === undefined
          ? undefined
          : {
              analysis: {
                payloadMode: "canonical-delta",
                data: request.sectionData as unknown as JsonValue,
              },
            },
      buildWrites: (revision_context) => {
        const writes: ProjectDatabaseWrite[] = [
          (database) =>
            database.upsert_meta_entries(request.projectPath, meta as unknown as JsonRecord),
        ];
        if (request.mode === "all") {
          writes.push(
            (database) => database.delete_analysis_item_checkpoints(request.projectPath),
            (database) => database.clear_analysis_candidate_aggregates(request.projectPath),
          );
        } else {
          writes.push((database) =>
            database.delete_analysis_item_checkpoints(request.projectPath, "ERROR"),
          );
        }
        writes.push(...this.build_section_revision_writes(revision_context));
        return writes;
      },
    });
  }

  /**
   * 校对统一字段 patch 使用局部 JSON 更新，并由后端发布 field-patch。
   */
  public async apply_proofreading_item_patch(request: {
    projectPath: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    source: string;
    changes: ProjectItemWriteChange[];
    fieldPatch: ProjectChangeItemFieldPatch;
  }): Promise<ProjectWriteResult> {
    if (request.changes.length === 0) {
      return this.empty_project_write_result();
    }
    const changed_item_ids = request.changes.map((change) => change.item_id);
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["items", "proofreading"],
      source: request.source,
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: changed_item_ids,
        fieldPatch: request.fieldPatch,
      },
      buildWrites: (revision_context) => {
        const translation_extras = this.has_translation_status_change(request.changes)
          ? this.build_translation_extras_after_status_changes(
              request.projectPath,
              revision_context,
              request.changes,
            )
          : null;
        const writes: ProjectDatabaseWrite[] = [
          (database) =>
            database.patch_item_fields_by_ids(
              request.projectPath,
              changed_item_ids,
              request.fieldPatch as unknown as JsonRecord,
            ),
        ];
        if (translation_extras !== null) {
          writes.push((database) =>
            database.upsert_meta_entries(request.projectPath, {
              translation_extras: translation_extras as unknown as JsonValue,
            } as unknown as JsonRecord),
          );
        }
        writes.push(...this.build_section_revision_writes(revision_context));
        return writes;
      },
    });
  }

  /**
   * 校对批量不同译文也只构造字段 patch，避免整行替换。
   */
  public async apply_proofreading_bulk_patch(request: {
    projectPath: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    source: string;
    changes: ProjectItemWriteChange[];
    itemsPayload: Pick<ProjectChangeItemsPayload, "payloadMode" | "changedIds" | "deleteIds">;
  }): Promise<ProjectWriteResult> {
    if (request.changes.length === 0) {
      return this.empty_project_write_result();
    }
    const patches = request.changes.map((change) => ({
      item_id: change.item_id,
      patch: this.build_translation_patch_from_items(change.current, change.next),
    }));
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["items", "proofreading"],
      source: request.source,
      updatedSections: ["items", "proofreading"],
      items: request.itemsPayload,
      buildWrites: (revision_context) => {
        const translation_extras = this.has_translation_status_change(request.changes)
          ? this.build_translation_extras_after_status_changes(
              request.projectPath,
              revision_context,
              request.changes,
            )
          : null;
        const writes: ProjectDatabaseWrite[] = [
          (database) =>
            database.patch_item_translation_fields(
              request.projectPath,
              this.to_database_translation_patches(patches),
            ),
        ];
        if (translation_extras !== null) {
          writes.push((database) =>
            database.upsert_meta_entries(request.projectPath, {
              translation_extras: translation_extras as unknown as JsonValue,
            } as unknown as JsonRecord),
          );
        }
        writes.push(...this.build_section_revision_writes(revision_context));
        return writes;
      },
    });
  }

  /**
   * 工作台结构性写入集中提交 asset、items、meta 与分析清理；当前事实命令须显式关闭 revision guard。
   */
  public async replace_project_items_and_files(
    request: {
      projectPath: string;
      revisionSections: ProjectDataSection[];
      source: string;
      updatedSections: ProjectDataSection[];
      assetWrites?: ProjectAssetWrite[];
      items?: MutableJsonRecord[];
      meta?: MutableJsonRecord;
      resetAnalysis?: boolean;
      itemsPayload?: Pick<ProjectChangeItemsPayload, "payloadMode" | "changedIds" | "deleteIds">;
      filesPayload?: Pick<
        ProjectChangeFilesPayload,
        "payloadMode" | "changedPaths" | "deletePaths"
      >;
      sections?: RuntimeCommitRequest["sections"];
      sectionModes?: Partial<Record<ProjectDataSection, ProjectChangePayloadMode>>;
    } & (
      | {
          requireExpectedSectionRevisions: false;
          expectedSectionRevisions?: undefined;
        }
      | {
          requireExpectedSectionRevisions?: true;
          expectedSectionRevisions: ProjectExpectedSectionRevisions;
        }
    ),
  ): Promise<ProjectWriteResult> {
    const items_payload =
      request.itemsPayload ??
      (request.items !== undefined && request.updatedSections.includes("items")
        ? { payloadMode: "section-invalidated" as const }
        : undefined);
    const files_payload =
      request.filesPayload ??
      ((request.assetWrites?.length ?? 0) > 0 && request.updatedSections.includes("files")
        ? { payloadMode: "section-invalidated" as const }
        : undefined);
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: request.requireExpectedSectionRevisions ?? true,
      revisionSections: request.revisionSections,
      source: request.source,
      updatedSections: request.updatedSections,
      items: items_payload,
      files: files_payload,
      sections: request.sections,
      sectionModes: request.sectionModes,
      buildWrites: (revision_context) => {
        const writes: ProjectDatabaseWrite[] = [];
        for (const write of request.assetWrites ?? []) {
          writes.push(this.build_asset_write(request.projectPath, write));
        }
        if (request.items !== undefined) {
          writes.push((database) =>
            database.set_items(request.projectPath, request.items as unknown as JsonValue[]),
          );
        }
        if (request.meta !== undefined && Object.keys(request.meta).length > 0) {
          writes.push((database) =>
            database.upsert_meta_entries(
              request.projectPath,
              request.meta as unknown as JsonRecord,
            ),
          );
        }
        if (request.resetAnalysis === true) {
          writes.push(
            (database) => database.delete_analysis_item_checkpoints(request.projectPath),
            (database) => database.clear_analysis_candidate_aggregates(request.projectPath),
          );
        }
        writes.push(...this.build_section_revision_writes(revision_context));
        return writes;
      },
    });
  }

  /**
   * 文件排序只触碰 asset sort_order 和 files revision。
   */
  public async reorder_project_files(request: {
    projectPath: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    orderedPaths: string[];
  }): Promise<ProjectWriteResult> {
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["files"],
      source: "project_reorder_files",
      updatedSections: ["files"],
      files: { payloadMode: "section-invalidated" },
      buildWrites: (revision_context) => [
        (database) => database.update_asset_sort_orders(request.projectPath, request.orderedPaths),
        ...this.build_section_revision_writes(revision_context),
      ],
    });
  }

  /**
   * 项目设置镜像写入只发布内部 committed event，公开响应仍保持旧空变更语义。
   */
  public async apply_project_settings_meta(request: {
    projectPath: string;
    meta: MutableJsonRecord;
  }): Promise<ProjectWriteResult> {
    return await this.commit_runtime_change(
      {
        projectPath: request.projectPath,
        requireExpectedSectionRevisions: false,
        revisionSections: ["project"],
        source: "settings_alignment",
        updatedSections: ["project"],
        buildWrites: () => [
          (database) =>
            database.upsert_meta_entries(
              request.projectPath,
              request.meta as unknown as JsonRecord,
            ),
        ],
      },
      { publishPublic: false },
    );
  }

  /**
   * 翻译重置提交完整后端生成 item 集合，但提交管线仍统一。
   */
  public async reset_translation_state(request: {
    projectPath: string;
    items: MutableJsonRecord[];
    translationExtras: MutableJsonRecord;
  }): Promise<ProjectWriteResult> {
    return await this.replace_project_items_and_files({
      projectPath: request.projectPath,
      requireExpectedSectionRevisions: false,
      revisionSections: ["items"],
      source: "translation_reset",
      updatedSections: ["items"],
      items: request.items,
      meta: {
        translation_extras: request.translationExtras as unknown as JsonValue,
      },
    });
  }

  /**
   * 分析候选导入同时处理 quality 和 analysis 的 revision 语义。
   */
  public async import_analysis_glossary(request: {
    projectPath: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    qualityRule: {
      databaseType: string;
      entries: MutableJsonRecord[];
      revisionKey: string;
    } | null;
    consumedCandidateSrcs: string[];
    analysisCandidateCount: number;
    updatedSections: ProjectDataSection[];
  }): Promise<ProjectWriteResult> {
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["analysis", "quality"],
      source: "analysis_glossary_import",
      updatedSections: request.updatedSections,
      buildWrites: (revision_context) => {
        const writes: ProjectDatabaseWrite[] = [];
        if (request.qualityRule !== null) {
          const quality_rule = request.qualityRule;
          writes.push(
            (database) =>
              database.set_rules(
                request.projectPath,
                quality_rule.databaseType,
                quality_rule.entries as unknown as JsonValue[],
              ),
            (database) =>
              database.set_meta(
                request.projectPath,
                quality_rule.revisionKey,
                get_section_revision(revision_context.meta, "quality") + 1,
              ),
          );
        }
        writes.push(
          (database) =>
            database.delete_analysis_candidate_aggregates_by_srcs(
              request.projectPath,
              request.consumedCandidateSrcs,
            ),
          (database) =>
            database.set_meta(
              request.projectPath,
              "analysis_candidate_count",
              request.analysisCandidateCount,
            ),
          ...this.build_section_revision_writes(revision_context, ["analysis"]),
        );
        return writes;
      },
    });
  }

  /**
   * 质量规则条目和 meta 统一走 quality 运行态写入口。
   */
  public async save_quality_rules(request: {
    projectPath: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    source: string;
    rule?:
      | {
          databaseType: string;
          entries: JsonRecord[];
        }
      | undefined;
    metaEntries?: MutableJsonRecord;
    revisionKey: string;
  }): Promise<ProjectWriteResult> {
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["quality"],
      source: request.source,
      updatedSections: ["quality"],
      buildWrites: (revision_context) => {
        const writes: ProjectDatabaseWrite[] = [];
        if (request.rule !== undefined) {
          const rule = request.rule;
          writes.push((database) =>
            database.set_rules(
              request.projectPath,
              rule.databaseType,
              rule.entries as unknown as JsonValue[],
            ),
          );
        }
        for (const [key, value] of Object.entries(request.metaEntries ?? {})) {
          writes.push((database) =>
            database.set_meta(request.projectPath, key, value as unknown as JsonValue),
          );
        }
        writes.push((database) =>
          database.set_meta(
            request.projectPath,
            request.revisionKey,
            get_section_revision(revision_context.meta, "quality") + 1,
          ),
        );
        return writes;
      },
    });
  }

  /**
   * 工程提示词写入由 prompts section 独立提交。
   */
  public async save_prompt(request: {
    projectPath: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    promptRuleType: string;
    text: string;
    revisionKey: string;
    enabledMetaKey?: string;
    enabled?: boolean;
  }): Promise<ProjectWriteResult> {
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["prompts"],
      source: "quality_prompt_save",
      updatedSections: ["prompts"],
      buildWrites: (revision_context) => {
        const writes: ProjectDatabaseWrite[] = [
          (database) =>
            database.set_rule_text(request.projectPath, request.promptRuleType, request.text),
          (database) =>
            database.set_meta(
              request.projectPath,
              request.revisionKey,
              get_section_revision(revision_context.meta, "prompts") + 1,
            ),
        ];
        if (request.enabledMetaKey !== undefined && request.enabled !== undefined) {
          const enabled_meta_key = request.enabledMetaKey;
          const enabled = request.enabled;
          writes.push((database) =>
            database.set_meta(request.projectPath, enabled_meta_key, enabled),
          );
        }
        return writes;
      },
    });
  }

  /**
   * 一次性应用领域任务输入；物理规则类型、meta key 与 revision 都留在 project 内部。
   */
  public async apply_task_input(request: {
    projectPath: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    input: ProjectTaskInput;
  }): Promise<ProjectWriteResult> {
    const updated_sections: ProjectDataSection[] = [];
    if (request.input.quality_rules.length > 0) {
      updated_sections.push("quality");
    }
    if (request.input.prompts.length > 0) {
      updated_sections.push("prompts");
    }
    if (updated_sections.length === 0) {
      return this.empty_project_write_result();
    }
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: updated_sections,
      source: "project_task_input_apply",
      updatedSections: updated_sections,
      buildWrites: (revision_context) => {
        const writes: ProjectDatabaseWrite[] = [];
        const quality_revision = get_section_revision(revision_context.meta, "quality") + 1;
        for (const rule of request.input.quality_rules) {
          const storage = resolve_project_quality_rule_storage(rule.kind);
          writes.push((database) =>
            database.set_rules(
              request.projectPath,
              storage.database_type,
              rule.entries as unknown as JsonValue[],
            ),
          );
          const enabled_meta_key = storage.enabled_meta_key;
          if (enabled_meta_key !== null && rule.enabled !== null) {
            writes.push((database) =>
              database.set_meta(request.projectPath, enabled_meta_key, rule.enabled),
            );
          }
          const mode_meta_key = storage.mode_meta_key;
          if (mode_meta_key !== null && rule.mode !== null) {
            writes.push((database) =>
              database.set_meta(request.projectPath, mode_meta_key, rule.mode),
            );
          }
          writes.push((database) =>
            database.set_meta(request.projectPath, storage.revision_meta_key, quality_revision),
          );
        }
        const prompt_revision = get_section_revision(revision_context.meta, "prompts") + 1;
        for (const prompt of request.input.prompts) {
          const storage = resolve_project_prompt_storage(prompt.kind);
          writes.push(
            (database) =>
              database.set_rule_text(request.projectPath, storage.database_type, prompt.text),
            (database) =>
              database.set_meta(request.projectPath, storage.enabled_meta_key, prompt.enabled),
            (database) =>
              database.set_meta(request.projectPath, storage.revision_meta_key, prompt_revision),
          );
        }
        return writes;
      },
    });
  }

  /** 在单事务内按当前对象重算 Agent 意图，并只发布实际提交的 section。 */
  public async apply_agent_workspace_changes(request: {
    projectPath: string;
    source: "agent_workspace_apply";
    batch: AgentWorkspaceIntentBatch;
  }): Promise<{
    applied: AgentWorkspaceAppliedSummary;
    rejected: AgentWorkspaceRejectedChange[];
    destroyed: boolean;
    sectionRevisions: ProjectDataSectionRevisions;
  }> {
    const actual = this.database.transaction(request.projectPath, () => {
      const current_meta = this.read_project_meta(request.projectPath);
      const item_ids = [...new Set(request.batch.items.map((intent) => intent.item_id))];
      const items = this.database.get_items_by_ids(request.projectPath, item_ids);
      const quality_kinds = QUALITY_RULE_KINDS.filter((kind) => {
        const intents = request.batch.quality[kind];
        return intents.creates.length + intents.updates.length + intents.deletes.length > 0;
      });
      const quality = Object.fromEntries(
        quality_kinds.map((kind) => {
          const storage = resolve_project_quality_rule_storage(kind);
          return [kind, this.database.get_rules(request.projectPath, storage.database_type)];
        }),
      ) as Record<QualityRuleKind, JsonValue>;
      const prompt_kinds = [...new Set(request.batch.prompts.map((intent) => intent.kind))];
      const prompts = Object.fromEntries(
        prompt_kinds.map((kind) => {
          const storage = resolve_project_prompt_storage(kind);
          return [kind, this.database.get_rule_text(request.projectPath, storage.database_type)];
        }),
      ) as Partial<Record<PromptKind, string>>;
      const outcome = resolve_agent_workspace_writes({
        batch: request.batch,
        current: {
          items: Array.isArray(items) ? items.filter(is_json_record) : [],
          quality: Object.fromEntries(
            quality_kinds.map((kind) => [kind, Array.isArray(quality[kind]) ? quality[kind] : []]),
          ),
          prompts,
        },
        createQualityEntryId: create_quality_rule_entry_id,
      });
      if (!has_agent_workspace_applied_changes(outcome.applied)) return outcome;
      const updated_sections: ProjectDataSection[] = [];
      if (outcome.itemChanges.length > 0) updated_sections.push("items", "proofreading");
      if (outcome.qualityChanges.length > 0) updated_sections.push("quality");
      if (outcome.promptChanges.length > 0) updated_sections.push("prompts");
      const item_patches = outcome.itemChanges.map((change) => ({
        item_id: change.item_id,
        patch: this.build_translation_patch_from_items(change.current, change.next),
      }));
      if (item_patches.length > 0)
        this.database.patch_item_translation_fields(
          request.projectPath,
          this.to_database_translation_patches(item_patches),
        );
      if (item_patches.length > 0 && this.has_translation_status_change(outcome.itemChanges)) {
        const translation_extras = this.build_translation_extras_after_status_changes(
          request.projectPath,
          { project_path: request.projectPath, meta: current_meta, sections: updated_sections },
          outcome.itemChanges,
        );
        this.database.upsert_meta_entries(request.projectPath, {
          translation_extras: translation_extras as unknown as JsonValue,
        } as unknown as JsonRecord);
      }
      for (const change of outcome.qualityChanges) {
        const storage = resolve_project_quality_rule_storage(change.kind);
        this.database.set_rules(
          request.projectPath,
          storage.database_type,
          change.entries as unknown as JsonValue[],
        );
      }
      if (outcome.qualityChanges.length > 0) {
        const quality_revision = get_section_revision(current_meta, "quality") + 1;
        for (const kind of new Set(outcome.qualityChanges.map((change) => change.kind))) {
          const storage = resolve_project_quality_rule_storage(kind);
          this.database.set_meta(request.projectPath, storage.revision_meta_key, quality_revision);
        }
      }
      for (const change of outcome.promptChanges) {
        const storage = resolve_project_prompt_storage(change.kind);
        this.database.set_rule_text(request.projectPath, storage.database_type, change.text);
      }
      if (outcome.promptChanges.length > 0) {
        const prompt_revision = get_section_revision(current_meta, "prompts") + 1;
        for (const kind of new Set(outcome.promptChanges.map((change) => change.kind))) {
          const storage = resolve_project_prompt_storage(kind);
          this.database.set_meta(request.projectPath, storage.revision_meta_key, prompt_revision);
        }
      }
      for (const write of this.build_section_revision_writes({
        project_path: request.projectPath,
        meta: current_meta,
        sections: updated_sections,
      }))
        write(this.database);
      return outcome;
    });
    const updated_sections: ProjectDataSection[] = [];
    if (actual.itemChanges.length > 0) updated_sections.push("items", "proofreading");
    if (actual.qualityChanges.length > 0) updated_sections.push("quality");
    if (actual.promptChanges.length > 0) updated_sections.push("prompts");
    if (updated_sections.length === 0)
      return {
        applied: {},
        rejected: actual.rejected,
        destroyed: actual.rejected.some(
          (rejection) =>
            rejection.reason === "fp_mismatch" || rejection.reason === "target_missing",
        ),
        sectionRevisions: build_section_revisions_from_meta(
          this.read_project_meta(request.projectPath),
        ),
      };
    const change_request: ProjectWriteChangeRequest = {
      projectPath: request.projectPath,
      source: request.source,
      updatedSections: updated_sections,
      ...(actual.itemChanges.length === 0 ? {} : { items: { payloadMode: "section-invalidated" } }),
    };
    try {
      await this.publish_app_events_for_committed_change(change_request);
      this.publish_project_data_change(change_request);
    } catch (cause) {
      throw new AppErrors.AppError("data.committed_sync_failed", {
        cause,
        public_details: {
          committed: true,
          section_revisions: build_section_revisions_from_meta(
            this.read_project_meta(request.projectPath),
          ),
          action: "reload_project",
        },
        diagnostic_context: {
          reason: "project_committed_change_sync_failed",
          source: request.source,
        },
      });
    }
    return {
      applied: actual.applied,
      rejected: actual.rejected,
      destroyed: true,
      sectionRevisions: build_section_revisions_from_meta(
        this.read_project_meta(request.projectPath),
      ),
    };
  }

  /**
   * 任务 artifact item patch 共享同一写入链路和进度 meta 更新。
   */
  private async apply_task_item_patches(request: {
    projectPath: string;
    items: TranslationItemPatch[];
    translationExtras: MutableJsonRecord;
    source: string;
    updatedSections: ProjectDataSection[];
  }): Promise<ProjectWriteSectionAck> {
    const patches = request.items;
    this.assert_patch_targets_exist(request.projectPath, patches);
    const changed_item_ids = patches.map((patch) => patch.item_id);
    await this.commit_runtime_change({
      projectPath: request.projectPath,
      requireExpectedSectionRevisions: false,
      revisionSections: request.updatedSections,
      source: request.source,
      updatedSections: request.updatedSections,
      items: {
        payloadMode: "canonical-delta",
        changedIds: changed_item_ids,
      },
      buildWrites: (revision_context) => [
        (database) =>
          database.patch_item_translation_fields(
            request.projectPath,
            this.to_database_translation_patches(patches),
          ),
        (database) =>
          database.upsert_meta_entries(request.projectPath, {
            translation_extras: request.translationExtras as unknown as JsonValue,
          } as unknown as JsonRecord),
        ...this.build_section_revision_writes(revision_context),
      ],
    });
    return {
      changed_item_ids,
      section_revisions: this.build_section_revisions(request.projectPath, request.updatedSections),
    };
  }

  /**
   * 在同一事务内校验并提交；提交后的缓存、公开事件或 ack 读取失败统一标记 committed。
   */
  private async commit_runtime_change(
    request: RuntimeCommitRequest,
    options: RuntimeCommitOptions = {},
  ): Promise<ProjectWriteResult> {
    this.database.transaction(request.projectPath, () => {
      // guard、快照和写入必须共享同一个 BEGIN IMMEDIATE，不能给并发提交留下检查后窗口。
      const revision_context = request.requireExpectedSectionRevisions
        ? this.assert_expected_section_revisions(
            request.projectPath,
            request.expectedSectionRevisions,
            request.revisionSections,
          )
        : {
            project_path: request.projectPath,
            meta: this.read_project_meta(request.projectPath),
            sections: request.revisionSections,
          };
      const writes = request.buildWrites(revision_context);
      for (const write of writes) {
        write(this.database);
      }
    });
    const change_request: ProjectWriteChangeRequest = {
      projectPath: request.projectPath,
      source: request.source,
      updatedSections: request.updatedSections,
      ...(request.items === undefined ? {} : { items: request.items }),
      ...(request.files === undefined ? {} : { files: request.files }),
      ...(request.sections === undefined ? {} : { sections: request.sections }),
      ...(request.sectionModes === undefined ? {} : { sectionModes: request.sectionModes }),
    };
    // 事务已经提交；后续任一步失败都必须携带能够读取到的最新 revision，禁止调用方重试。
    let committed_section_revisions: ProjectDataSectionRevisions = {};
    try {
      committed_section_revisions = build_section_revisions_from_meta(
        this.read_project_meta(request.projectPath),
      );
      await this.publish_app_events_for_committed_change(change_request);
      if (options.publishPublic === false) {
        return this.empty_project_write_result();
      }
      return this.publish_project_data_change(change_request);
    } catch (cause) {
      throw new AppErrors.AppError("data.committed_sync_failed", {
        cause,
        public_details: {
          committed: true,
          section_revisions: committed_section_revisions as JsonValue,
          action: "reload_project",
        },
        diagnostic_context: {
          reason: "project_committed_change_sync_failed",
          source: request.source,
        },
      });
    }
  }

  /**
   * 无变化写入仍返回统一响应形状。
   */
  private empty_project_write_result(): ProjectWriteResult {
    return { accepted: true, changes: [] };
  }

  /**
   * 在当前事务中校验 section revision，并返回后续写入复用的 meta 快照。
   */
  private assert_expected_section_revisions(
    project_path: string,
    expected_section_revisions: ProjectExpectedSectionRevisions | undefined,
    sections: ProjectDataSection[],
  ): ProjectWriteRevisionContext {
    if (expected_section_revisions === undefined) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    const meta = this.read_project_meta(project_path);
    for (const section of sections) {
      if (!Object.hasOwn(expected_section_revisions, section)) {
        throw new AppErrors.AppError("request.validation_failed", {
          public_details: { section },
        });
      }
      const current_revision = get_section_revision(meta, section);
      const expected_revision = expected_section_revisions[section] ?? 0;
      if (current_revision !== expected_revision) {
        throw new AppErrors.AppError("data.revision_conflict", {
          public_details: { current_revision, expected_revision, section },
        });
      }
    }
    return { project_path, meta, sections: [...sections] };
  }

  /**
   * 基于 guard 的同一 meta 快照推进 section revision。
   */
  private build_section_revision_writes(
    context: ProjectWriteRevisionContext,
    sections = this.filter_revision_backed_sections(context.sections),
  ): ProjectDatabaseWrite[] {
    return sections.map(
      (section) => (database) =>
        database.set_meta(
          context.project_path,
          this.resolve_revision_meta_key(section),
          get_section_revision(context.meta, section) + 1,
        ),
    );
  }

  /** 只推进具备独立 revision meta 的 section。 */
  private filter_revision_backed_sections(sections: ProjectDataSection[]): RevisionBackedSection[] {
    return sections.filter(
      (section): section is RevisionBackedSection =>
        section === "files" ||
        section === "items" ||
        section === "analysis" ||
        section === "proofreading",
    );
  }

  /** proofreading 与 runtime section 使用不同 meta key。 */
  private resolve_revision_meta_key(section: RevisionBackedSection): string {
    return section === "proofreading"
      ? "proofreading_revision.proofreading"
      : `project_runtime_revision.${section}`;
  }

  /**
   * 内部 cache 事件完成后才允许生成公开变更响应。
   */
  private publish_project_data_change(request: ProjectWriteChangeRequest): ProjectWriteResult {
    if (this.project_change_publisher === null || request.updatedSections.length === 0) {
      return this.empty_project_write_result();
    }
    const change_event = this.project_change_publisher(request);
    return change_event === null || change_event === undefined
      ? this.empty_project_write_result()
      : { accepted: true, changes: [change_event] };
  }

  /**
   * 事务成功后串行通知内部 cache handler。
   */
  private async publish_app_events_for_committed_change(
    request: ProjectWriteChangeRequest,
  ): Promise<void> {
    for (const event of this.build_app_events_after_commit(request)) {
      await this.project_event_handler(event);
    }
  }

  /**
   * 将提交结果拆成 cache 消费的内部领域事件。
   */
  private build_app_events_after_commit(request: ProjectWriteChangeRequest): ProjectEvent[] {
    const section_revisions = build_section_revisions_from_meta(
      this.read_project_meta(request.projectPath),
    );
    const common = {
      projectPath: request.projectPath,
      source: request.source,
      affectedSections: request.updatedSections,
      sectionRevisions: section_revisions,
    };
    const events: ProjectEvent[] = [];
    if (
      request.updatedSections.some(
        (section) => section === "items" || section === "files" || section === "proofreading",
      )
    ) {
      events.push({
        ...common,
        type: "project.items.changed",
        items: request.items,
        files: request.files,
        scope: request.items?.changedIds === undefined ? "items-full" : "items-partial",
      });
    }
    if (request.updatedSections.includes("quality")) {
      events.push({
        ...common,
        type: "project.quality.changed",
        scope: "quality-full",
      });
    }
    if (request.updatedSections.includes("prompts")) {
      events.push({
        ...common,
        type: "project.prompts.changed",
        scope: "prompts-full",
      });
    }
    if (request.updatedSections.includes("analysis")) {
      events.push({
        ...common,
        type: "project.analysis.changed",
        sections: request.sections,
        scope: "analysis-full",
      });
    }
    if (request.updatedSections.includes("project")) {
      events.push({ ...common, type: "project.settings.changed" });
    }
    return events;
  }

  /**
   * 将项目 asset 操作转换为数据库 workflow 操作。
   */
  private build_asset_write(project_path: string, write: ProjectAssetWrite): ProjectDatabaseWrite {
    if (write.kind === "add_from_source") {
      return (database) =>
        database.add_asset_from_source(project_path, write.path, write.sourcePath, write.sortOrder);
    }
    if (write.kind === "update_from_source") {
      return (database) =>
        database.update_asset_from_source(project_path, write.path, write.sourcePath);
    }
    return (database) => database.delete_asset(project_path, write.path);
  }

  /**
   * 在进入事务前确认所有 artifact item_id 都指向现有项目事实。
   */
  private assert_patch_targets_exist(project_path: string, patches: TranslationItemPatch[]): void {
    const rows = this.database.get_item_write_facts_by_ids(
      project_path,
      patches.map((patch) => patch.item_id),
    );
    const existing_ids = new Set<number>();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (is_json_record(row)) {
          const item_id = read_json_integer(row["id"], 0);
          if (item_id > 0) {
            existing_ids.add(item_id);
          }
        }
      }
    }
    for (const patch of patches) {
      if (!existing_ids.has(patch.item_id)) {
        throw new AppErrors.AppError("runtime.internal_invariant", {
          diagnostic_context: {
            reason: "translation_patch_item_not_found",
            item_id: patch.item_id,
          },
        });
      }
    }
  }

  /**
   * 将领域 patch 包装为 database 批量写入口的物理 JSON 形状。
   */
  private to_database_translation_patches(patches: TranslationItemPatch[]): JsonValue[] {
    return patches.map((patch) => ({
      id: patch.item_id,
      patch: patch.patch as unknown as JsonValue,
    })) as unknown as JsonValue[];
  }

  /**
   * 复用公开字段差异算法构造校对 patch，并拒绝无变化提交。
   */
  private build_translation_patch_from_items(
    current: Readonly<ProjectItemWriteFields>,
    next: Readonly<ProjectItemWriteFields>,
  ): TranslationItemPatch["patch"] {
    const patch = build_project_item_field_patch(current, next);
    if (patch === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "empty_proofreading_patch" },
      });
    }
    return patch;
  }

  /** 翻译统计只由状态变化驱动，调用方不再传递派生布尔值。 */
  private has_translation_status_change(changes: readonly ProjectItemWriteChange[]): boolean {
    return changes.some(({ current, next }) => current.status !== next.status);
  }

  /**
   * 优先沿用可信持久计数；旧项目缺失计数时从数据库摘要补齐，再应用状态增量。
   */
  private build_translation_extras_after_status_changes(
    project_path: string,
    revision_context: ProjectWriteRevisionContext,
    changes: readonly ProjectItemWriteChange[],
  ): Record<string, unknown> {
    const stored_progress = {
      ...read_json_record(revision_context.meta["translation_extras"]),
    };
    const progress = this.read_translation_progress(revision_context.meta);
    const counters = this.has_translation_progress_counters(stored_progress)
      ? this.read_translation_progress_counters(progress)
      : this.get_translation_status_summary(project_path);
    const next_counters = this.apply_translation_status_deltas(counters, changes);
    return {
      ...progress,
      ...next_counters,
    };
  }

  /**
   * 用空闲任务默认值补齐项目内 translation_extras。
   */
  private read_translation_progress(meta: JsonRecord): Record<string, unknown> {
    const empty_snapshot = create_empty_translation_task_snapshot();
    return {
      ...read_json_record(empty_snapshot["progress"] as JsonValue),
      ...read_json_record(meta["translation_extras"]),
    };
  }

  /**
   * 只有三项基础计数都是有限数字时才允许增量维护。
   */
  private has_translation_progress_counters(progress: Record<string, unknown>): boolean {
    return (
      this.is_finite_number(progress["total_line"]) &&
      this.is_finite_number(progress["processed_line"]) &&
      this.is_finite_number(progress["error_line"])
    );
  }

  /**
   * 将可信翻译进度收窄为非负整数计数。
   */
  private read_translation_progress_counters(
    progress: Record<string, unknown>,
  ): TranslationProgressCounters {
    const processed_line = this.read_non_negative_integer(progress["processed_line"]);
    const error_line = this.read_non_negative_integer(progress["error_line"]);
    return {
      total_line: this.read_non_negative_integer(progress["total_line"]),
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 旧项目缺少持久计数时从 item 状态聚合一次完整基线。
   */
  private get_translation_status_summary(project_path: string): TranslationProgressCounters {
    const summary = {
      ...read_json_record(this.database.get_item_status_summary(project_path)),
    };
    const processed_line = this.read_non_negative_integer(summary["processed_line"]);
    const error_line = this.read_non_negative_integer(summary["error_line"]);
    return {
      total_line: this.read_non_negative_integer(summary["total_line"]),
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 按每个 item 的前后状态调整计数，避免校对保存后全表重算。
   */
  private apply_translation_status_deltas(
    counters: TranslationProgressCounters,
    changes: readonly ProjectItemWriteChange[],
  ): TranslationProgressCounters {
    let total_line = counters.total_line;
    let processed_line = counters.processed_line;
    let error_line = counters.error_line;
    for (const change of changes) {
      const before = this.count_translation_status(change.current.status);
      const after = this.count_translation_status(change.next.status);
      total_line += after.total_line - before.total_line;
      processed_line += after.processed_line - before.processed_line;
      error_line += after.error_line - before.error_line;
    }
    processed_line = Math.max(0, Math.trunc(processed_line));
    error_line = Math.max(0, Math.trunc(error_line));
    return {
      total_line: Math.max(0, Math.trunc(total_line)),
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 将单个状态映射为翻译进度的四项计数贡献。
   */
  private count_translation_status(status: string): TranslationProgressCounters {
    const is_progress_status = is_task_progress_status(status);
    const processed_line = status === "PROCESSED" ? 1 : 0;
    const error_line = status === "ERROR" ? 1 : 0;
    return {
      total_line: is_progress_status ? 1 : 0,
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 只合并本批触及的候选 src，并用前后局部计数修正全局候选数。
   */
  private build_next_candidate_rows(
    project_path: string,
    glossary_entries: AnalysisGlossaryWrite[],
    current_count: number,
  ): { rows: MutableJsonRecord[]; count: number } {
    const normalized_entries = glossary_entries.filter((entry) => {
      const src = entry.src.trim();
      const dst = entry.dst.trim();
      return src !== "" && dst !== "";
    });
    if (normalized_entries.length === 0) {
      return { rows: [], count: Math.max(0, current_count) };
    }
    const touched_srcs = [...new Set(normalized_entries.map((entry) => entry.src.trim()))];
    const aggregate = new Map<string, MutableJsonRecord>();
    for (const row of this.get_candidate_aggregate_by_srcs(project_path, touched_srcs)) {
      const src = String(row["src"] ?? "").trim();
      if (src !== "") {
        aggregate.set(src, {
          ...row,
          dst_votes: this.normalize_vote_map(row["dst_votes"]),
          info_votes: this.normalize_vote_map(row["info_votes"]),
        });
      }
    }
    const previous_touched_count = this.count_candidate_entries([...aggregate.values()]);
    const now = new Date().toISOString();
    for (const entry of normalized_entries) {
      const src = entry.src.trim();
      const dst = entry.dst.trim();
      if (src === "" || dst === "") {
        continue;
      }
      const current =
        aggregate.get(src) ??
        ({
          src,
          dst_votes: {},
          info_votes: {},
          observation_count: 0,
          first_seen_at: now,
          last_seen_at: now,
          case_sensitive: entry.case_sensitive,
        } as MutableJsonRecord);
      const dst_votes = this.normalize_vote_map(current["dst_votes"]);
      const info_votes = this.normalize_vote_map(current["info_votes"]);
      const info = entry.info.trim();
      dst_votes[dst] = read_json_integer(dst_votes[dst] as JsonValue, 0) + 1;
      if (info !== "") {
        info_votes[info] = read_json_integer(info_votes[info] as JsonValue, 0) + 1;
      }
      current["dst_votes"] = dst_votes as unknown as JsonValue;
      current["info_votes"] = info_votes as unknown as JsonValue;
      current["observation_count"] = read_json_integer(current["observation_count"], 0) + 1;
      current["last_seen_at"] = now;
      current["case_sensitive"] = Boolean(current["case_sensitive"]) || entry.case_sensitive;
      aggregate.set(src, current);
    }
    const rows = [...aggregate.values()];
    const next_touched_count = this.count_candidate_entries(rows);
    return {
      rows,
      count: Math.max(0, current_count - previous_touched_count + next_touched_count),
    };
  }

  /**
   * 复用候选聚合规则统计可展示条目数。
   */
  private count_candidate_entries(rows: MutableJsonRecord[]): number {
    return count_analysis_glossary_candidates(rows);
  }

  /**
   * 丢弃空文本和非正票数，并合并归一化后的同名票项。
   */
  private normalize_vote_map(value: JsonValue | undefined): Record<string, number> {
    if (!is_json_record(value)) {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [key, raw_votes] of Object.entries(value)) {
      const text = String(key).trim();
      const votes = read_json_integer(raw_votes, 0);
      if (text !== "" && votes > 0) {
        result[text] = (result[text] ?? 0) + votes;
      }
    }
    return result;
  }

  /**
   * 错误 checkpoint 基于旧 ERROR 记录递增 error_count，并刷新提交时间。
   */
  private build_error_checkpoint_rows(
    project_path: string,
    rows: AnalysisCheckpointWrite[],
  ): MutableJsonRecord[] {
    const existing = new Map<number, MutableJsonRecord>();
    for (const row of this.get_analysis_checkpoints(project_path)) {
      existing.set(read_json_integer(row["item_id"], 0), row);
    }
    const now = new Date().toISOString();
    return rows.map((row) => {
      const item_id = row.item_id;
      const previous = existing.get(item_id);
      const previous_error_count =
        previous?.["status"] === "ERROR" ? read_json_integer(previous["error_count"], 0) : 0;
      return {
        ...row,
        status: "ERROR",
        updated_at: now,
        error_count: previous_error_count + 1,
      };
    });
  }

  /**
   * 从 database JSON 结果中过滤并复制合法 checkpoint 记录。
   */
  private get_analysis_checkpoints(project_path: string): MutableJsonRecord[] {
    const value = this.database.get_analysis_item_checkpoints(project_path);
    return Array.isArray(value)
      ? value.filter((row): row is JsonRecord => is_json_record(row)).map((row) => ({ ...row }))
      : [];
  }

  /**
   * 只读取本批 src 的候选聚合，并隔离数据库返回引用。
   */
  private get_candidate_aggregate_by_srcs(
    project_path: string,
    srcs: string[],
  ): MutableJsonRecord[] {
    const value = this.database.get_analysis_candidate_aggregates_by_srcs(project_path, srcs);
    return Array.isArray(value)
      ? value.filter((row): row is JsonRecord => is_json_record(row)).map((row) => ({ ...row }))
      : [];
  }

  /**
   * 从提交后的单次 meta 快照构造 ack 需要的 section revision。
   */
  private build_section_revisions(
    project_path: string,
    sections: ProjectDataSection[],
  ): MutableJsonRecord {
    const meta = this.read_project_meta(project_path);
    const result: MutableJsonRecord = {};
    for (const section of sections) {
      result[section] = get_section_revision(meta, section);
    }
    return result;
  }

  /**
   * 将 database meta 结果收窄并复制为可计算对象。
   */
  private read_project_meta(project_path: string): MutableJsonRecord {
    return { ...read_json_record(this.database.get_all_meta(project_path)) };
  }

  /**
   * 判断持久进度字段能否作为可信增量基线。
   */
  private is_finite_number(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value);
  }

  /**
   * 将旧持久计数归一为非负整数，异常值回退到零。
   */
  private read_non_negative_integer(value: unknown): number {
    const number_value = typeof value === "number" ? value : Number(value ?? 0);
    if (!Number.isFinite(number_value)) {
      return 0;
    }
    return Math.max(0, Math.trunc(number_value));
  }
}
