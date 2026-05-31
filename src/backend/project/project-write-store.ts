import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import { Item, type ItemName, type ItemStatus } from "../../domain/item";
import { is_task_progress_status, TASK_PROGRESS_STATUSES } from "../../domain/task";
import { count_analysis_glossary_candidates } from "../../shared/analysis-candidate";
import type {
  ProjectChangeFilesPayload,
  ProjectChangeItemFieldPatch,
  ProjectChangeItemsPayload,
  ProjectChangePayloadMode,
  ProjectDataSection,
  ProjectWriteResult,
} from "../../shared/project-event";
import * as AppErrors from "../../shared/error";
import { get_section_revision } from "./project-data";
import {
  create_empty_translation_task_snapshot,
  ProjectWriteCoordinator,
  type ProjectWriteChangeRequest,
  type ProjectWriteRevisionContext,
} from "./project-changes";
import type { ProjectChangePublisher } from "./project-changes";
import type { ProjectEventBus } from "./project-events";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

export type TranslationItemPatch = {
  item_id: number; // 任务 artifact 和公开项目行的唯一主键
  patch: {
    dst?: string;
    name_dst?: ItemName;
    status?: ItemStatus;
    retry_count?: number;
  };
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
  expectedSectionRevisions?: ApiJsonValue;
  requireExpectedSectionRevisions: boolean;
  revisionSections: ProjectDataSection[];
  source: string;
  updatedSections: ProjectDataSection[];
  buildOperations: (context: ProjectWriteRevisionContext) => DatabaseOperation[];
  items?: Pick<
    ProjectChangeItemsPayload,
    "payloadMode" | "changedIds" | "deleteIds" | "fieldPatch"
  >;
  files?: Pick<ProjectChangeFilesPayload, "payloadMode" | "changedPaths" | "deletePaths">;
  sections?: Partial<
    Record<ProjectDataSection, { payloadMode: ProjectChangePayloadMode; data?: ApiJsonValue }>
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

type ProofreadingItemChange = {
  current: MutableJsonRecord;
  next: MutableJsonRecord;
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

  private readonly write_coordinator: ProjectWriteCoordinator; // coordinator 统一 revision guard 与 committed event 发布

  public constructor(
    database: ProjectDatabase,
    project_event_bus: ProjectEventBus,
    project_change_publisher: ProjectChangePublisher | null,
  ) {
    this.database = database;
    this.write_coordinator = new ProjectWriteCoordinator(
      database,
      project_change_publisher,
      project_event_bus,
    );
  }

  /**
   * 普通翻译 artifact 只按 item_id 局部更新译文字段。
   */
  public async apply_translation_item_patches(request: {
    projectPath: string;
    items: ApiJsonValue | undefined;
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
    items: ApiJsonValue | undefined;
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
    this.database.execute_transaction([
      this.op("upsertMetaEntries", {
        projectPath: request.projectPath,
        meta: request.meta as unknown as DatabaseJsonValue,
      }),
    ]);
  }

  /**
   * 分析 artifact 写入 checkpoint、候选聚合和进度，并发布轻量 analysis 增量。
   */
  public async commit_analysis_artifacts(request: {
    projectPath: string;
    successCheckpoints: ApiJsonValue | undefined;
    errorCheckpoints: ApiJsonValue | undefined;
    glossaryEntries: ApiJsonValue | undefined;
    progressSnapshot: ApiJsonValue | undefined;
  }): Promise<MutableJsonRecord> {
    const project_path = request.projectPath;
    const success_checkpoints = this.normalize_checkpoint_rows(request.successCheckpoints);
    const error_checkpoints = this.normalize_error_checkpoint_rows(
      project_path,
      request.errorCheckpoints,
    );
    const glossary_entries = this.normalize_glossary_entries(request.glossaryEntries);
    const progress_snapshot = this.normalize_nullable_progress_snapshot(request.progressSnapshot);
    const meta = this.read_project_meta(project_path);
    const candidate_result = this.build_next_candidate_rows(
      project_path,
      glossary_entries,
      this.read_number(meta["analysis_candidate_count"], 0),
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
          data: this.build_analysis_section_delta(
            progress_snapshot ?? this.normalize_object(meta["analysis_extras"]),
            candidate_result.count,
          ) as unknown as ApiJsonValue,
        },
      },
      buildOperations: (revision_context) => {
        const operations: DatabaseOperation[] = [];
        if (success_checkpoints.length > 0 || error_checkpoints.length > 0) {
          operations.push(
            this.op("upsertAnalysisItemCheckpoints", {
              projectPath: project_path,
              checkpoints: [
                ...success_checkpoints,
                ...error_checkpoints,
              ] as unknown as DatabaseJsonValue,
            }),
          );
        }
        if (candidate_result.rows.length > 0) {
          operations.push(
            this.op("upsertAnalysisCandidateAggregates", {
              projectPath: project_path,
              aggregates: candidate_result.rows as unknown as DatabaseJsonValue,
            }),
          );
        }
        operations.push(
          this.op("upsertMetaEntries", {
            projectPath: project_path,
            meta: {
              ...(progress_snapshot === null ? {} : { analysis_extras: progress_snapshot }),
              analysis_candidate_count: candidate_result.count,
            } as unknown as DatabaseJsonValue,
          }),
          ...this.write_coordinator.build_section_revision_operations(revision_context),
        );
        return operations;
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
    expectedSectionRevisions?: ApiJsonValue;
    requireExpectedSectionRevisions: boolean;
    source: string;
    mode: "all" | "failed";
    analysisExtras: MutableJsonRecord;
    analysisCandidateCount?: number;
    sectionData?: MutableJsonRecord;
  }): Promise<ProjectWriteResult> {
    const meta: MutableJsonRecord = {
      analysis_extras: request.analysisExtras as unknown as ApiJsonValue,
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
                data: request.sectionData as unknown as ApiJsonValue,
              },
            },
      buildOperations: (revision_context) => {
        const operations: DatabaseOperation[] = [
          this.op("upsertMetaEntries", {
            projectPath: request.projectPath,
            meta: meta as unknown as DatabaseJsonValue,
          }),
        ];
        if (request.mode === "all") {
          operations.push(
            this.op("deleteAnalysisItemCheckpoints", { projectPath: request.projectPath }),
            this.op("clearAnalysisCandidateAggregates", { projectPath: request.projectPath }),
          );
        } else {
          operations.push(
            this.op("deleteAnalysisItemCheckpoints", {
              projectPath: request.projectPath,
              status: "ERROR",
            }),
          );
        }
        operations.push(
          ...this.write_coordinator.build_section_revision_operations(revision_context),
        );
        return operations;
      },
    });
  }

  /**
   * 校对统一字段 patch 使用局部 JSON 更新，并由后端发布 field-patch。
   */
  public async apply_proofreading_item_patch(request: {
    projectPath: string;
    expectedSectionRevisions: ApiJsonValue | undefined;
    changes: ProofreadingItemChange[];
    fieldPatch: ProjectChangeItemFieldPatch;
    updateTranslationExtras: boolean;
  }): Promise<ProjectWriteResult> {
    if (request.changes.length === 0) {
      return this.empty_project_write_result();
    }
    const changed_item_ids = this.collect_changed_item_ids(request.changes);
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["items", "proofreading"],
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: changed_item_ids,
        fieldPatch: request.fieldPatch,
      },
      buildOperations: (revision_context) => {
        const operations: DatabaseOperation[] = [
          this.op("patchItemFieldsByIds", {
            projectPath: request.projectPath,
            itemIds: changed_item_ids as unknown as DatabaseJsonValue,
            patch: request.fieldPatch as unknown as DatabaseJsonValue,
          }),
        ];
        if (request.updateTranslationExtras) {
          operations.push(
            this.op("upsertMetaEntries", {
              projectPath: request.projectPath,
              meta: {
                translation_extras: this.build_translation_extras_after_status_changes(
                  request.projectPath,
                  revision_context,
                  request.changes,
                ) as unknown as ApiJsonValue,
              } as unknown as DatabaseJsonValue,
            }),
          );
        }
        operations.push(
          ...this.write_coordinator.build_section_revision_operations(revision_context),
        );
        return operations;
      },
    });
  }

  /**
   * 校对批量不同译文也只构造字段 patch，避免整行替换。
   */
  public async apply_proofreading_bulk_patch(request: {
    projectPath: string;
    expectedSectionRevisions: ApiJsonValue | undefined;
    changes: ProofreadingItemChange[];
    itemsPayload: Pick<ProjectChangeItemsPayload, "payloadMode" | "changedIds" | "deleteIds">;
    updateTranslationExtras: boolean;
  }): Promise<ProjectWriteResult> {
    if (request.changes.length === 0) {
      return this.empty_project_write_result();
    }
    const patches = request.changes.map((change) => ({
      item_id: this.read_positive_item_id(change.next["id"], "proofreading_patch_item_id"),
      patch: this.build_translation_patch_from_items(change.current, change.next),
    }));
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["items", "proofreading"],
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: request.itemsPayload,
      buildOperations: (revision_context) => {
        const operations: DatabaseOperation[] = [
          this.op("patchItemTranslationFields", {
            projectPath: request.projectPath,
            patches: this.to_database_translation_patches(patches),
          }),
        ];
        if (request.updateTranslationExtras) {
          operations.push(
            this.op("upsertMetaEntries", {
              projectPath: request.projectPath,
              meta: {
                translation_extras: this.build_translation_extras_after_status_changes(
                  request.projectPath,
                  revision_context,
                  request.changes,
                ) as unknown as ApiJsonValue,
              } as unknown as DatabaseJsonValue,
            }),
          );
        }
        operations.push(
          ...this.write_coordinator.build_section_revision_operations(revision_context),
        );
        return operations;
      },
    });
  }

  /**
   * 工作台结构性写入集中提交 asset、items、meta 与分析清理。
   */
  public async replace_workbench_items_and_files(request: {
    projectPath: string;
    expectedSectionRevisions: ApiJsonValue | undefined;
    revisionSections: ProjectDataSection[];
    source: string;
    updatedSections: ProjectDataSection[];
    assetWrites?: ProjectAssetWrite[];
    items?: MutableJsonRecord[];
    meta?: MutableJsonRecord;
    resetAnalysis?: boolean;
    itemsPayload?: Pick<ProjectChangeItemsPayload, "payloadMode" | "changedIds" | "deleteIds">;
    filesPayload?: Pick<ProjectChangeFilesPayload, "payloadMode" | "changedPaths" | "deletePaths">;
    sections?: RuntimeCommitRequest["sections"];
    sectionModes?: Partial<Record<ProjectDataSection, ProjectChangePayloadMode>>;
  }): Promise<ProjectWriteResult> {
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
      requireExpectedSectionRevisions: true,
      revisionSections: request.revisionSections,
      source: request.source,
      updatedSections: request.updatedSections,
      items: items_payload,
      files: files_payload,
      sections: request.sections,
      sectionModes: request.sectionModes,
      buildOperations: (revision_context) => {
        const operations: DatabaseOperation[] = [];
        for (const write of request.assetWrites ?? []) {
          operations.push(this.build_asset_operation(request.projectPath, write));
        }
        if (request.items !== undefined) {
          operations.push(
            this.op("setItems", {
              projectPath: request.projectPath,
              items: request.items as unknown as DatabaseJsonValue,
            }),
          );
        }
        if (request.meta !== undefined && Object.keys(request.meta).length > 0) {
          operations.push(
            this.op("upsertMetaEntries", {
              projectPath: request.projectPath,
              meta: request.meta as unknown as DatabaseJsonValue,
            }),
          );
        }
        if (request.resetAnalysis === true) {
          operations.push(
            this.op("deleteAnalysisItemCheckpoints", { projectPath: request.projectPath }),
            this.op("clearAnalysisCandidateAggregates", { projectPath: request.projectPath }),
          );
        }
        operations.push(
          ...this.write_coordinator.build_section_revision_operations(revision_context),
        );
        return operations;
      },
    });
  }

  /**
   * 文件排序只触碰 asset sort_order 和 files revision。
   */
  public async reorder_workbench_files(request: {
    projectPath: string;
    expectedSectionRevisions: ApiJsonValue | undefined;
    orderedPaths: string[];
  }): Promise<ProjectWriteResult> {
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["files"],
      source: "workbench_reorder_files",
      updatedSections: ["files"],
      files: { payloadMode: "section-invalidated" },
      buildOperations: (revision_context) => [
        this.op("updateAssetSortOrders", {
          projectPath: request.projectPath,
          orderedPaths: request.orderedPaths as unknown as DatabaseJsonValue,
        }),
        ...this.write_coordinator.build_section_revision_operations(revision_context),
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
        buildOperations: () => [
          this.op("upsertMetaEntries", {
            projectPath: request.projectPath,
            meta: request.meta as unknown as DatabaseJsonValue,
          }),
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
    expectedSectionRevisions: ApiJsonValue | undefined;
    items: MutableJsonRecord[];
    translationExtras: MutableJsonRecord;
  }): Promise<ProjectWriteResult> {
    return await this.replace_workbench_items_and_files({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      revisionSections: ["items"],
      source: "translation_reset",
      updatedSections: ["items"],
      items: request.items,
      meta: {
        translation_extras: request.translationExtras as unknown as ApiJsonValue,
      },
    });
  }

  /**
   * 分析候选导入同时处理 quality 和 analysis 的 revision 语义。
   */
  public async import_analysis_glossary(request: {
    projectPath: string;
    expectedSectionRevisions: ApiJsonValue | undefined;
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
      buildOperations: (revision_context) => {
        const operations: DatabaseOperation[] = [];
        if (request.qualityRule !== null) {
          operations.push(
            this.op("setRules", {
              projectPath: request.projectPath,
              ruleType: request.qualityRule.databaseType,
              rules: request.qualityRule.entries as unknown as DatabaseJsonValue,
            }),
            this.op("setMeta", {
              projectPath: request.projectPath,
              key: request.qualityRule.revisionKey,
              value: get_section_revision(revision_context.meta, "quality") + 1,
            }),
          );
        }
        operations.push(
          this.op("deleteAnalysisCandidateAggregatesBySrcs", {
            projectPath: request.projectPath,
            srcs: request.consumedCandidateSrcs as unknown as DatabaseJsonValue,
          }),
          this.op("setMeta", {
            projectPath: request.projectPath,
            key: "analysis_candidate_count",
            value: request.analysisCandidateCount,
          }),
          ...this.write_coordinator.build_section_revision_operations(revision_context, [
            "analysis",
          ]),
        );
        return operations;
      },
    });
  }

  /**
   * 质量规则条目和 meta 统一走 quality 运行态写入口。
   */
  public async save_quality_rules(request: {
    projectPath: string;
    expectedSectionRevisions: ApiJsonValue | undefined;
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
      buildOperations: (revision_context) => {
        const operations: DatabaseOperation[] = [];
        if (request.rule !== undefined) {
          operations.push(
            this.op("setRules", {
              projectPath: request.projectPath,
              ruleType: request.rule.databaseType,
              rules: request.rule.entries as unknown as DatabaseJsonValue,
            }),
          );
        }
        for (const [key, value] of Object.entries(request.metaEntries ?? {})) {
          operations.push(this.op("setMeta", { projectPath: request.projectPath, key, value }));
        }
        operations.push(
          this.op("setMeta", {
            projectPath: request.projectPath,
            key: request.revisionKey,
            value: get_section_revision(revision_context.meta, "quality") + 1,
          }),
        );
        return operations;
      },
    });
  }

  /**
   * 工程提示词写入由 prompts section 独立提交。
   */
  public async save_quality_prompt(request: {
    projectPath: string;
    expectedSectionRevisions: ApiJsonValue | undefined;
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
      buildOperations: (revision_context) => {
        const operations: DatabaseOperation[] = [
          this.op("setRuleText", {
            projectPath: request.projectPath,
            ruleType: request.promptRuleType,
            text: request.text,
          }),
          this.op("setMeta", {
            projectPath: request.projectPath,
            key: request.revisionKey,
            value: get_section_revision(revision_context.meta, "prompts") + 1,
          }),
        ];
        if (request.enabledMetaKey !== undefined && request.enabled !== undefined) {
          operations.push(
            this.op("setMeta", {
              projectPath: request.projectPath,
              key: request.enabledMetaKey,
              value: request.enabled,
            }),
          );
        }
        return operations;
      },
    });
  }

  /**
   * 任务 artifact item patch 共享同一写入链路和进度 meta 更新。
   */
  private async apply_task_item_patches(request: {
    projectPath: string;
    items: ApiJsonValue | undefined;
    translationExtras: MutableJsonRecord;
    source: string;
    updatedSections: ProjectDataSection[];
  }): Promise<ProjectWriteSectionAck> {
    const patches = this.normalize_translation_item_patches(request.items);
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
      buildOperations: (revision_context) => [
        this.op("patchItemTranslationFields", {
          projectPath: request.projectPath,
          patches: this.to_database_translation_patches(patches),
        }),
        this.op("upsertMetaEntries", {
          projectPath: request.projectPath,
          meta: {
            translation_extras: request.translationExtras as unknown as ApiJsonValue,
          } as unknown as DatabaseJsonValue,
        }),
        ...this.write_coordinator.build_section_revision_operations(revision_context),
      ],
    });
    return {
      changed_item_ids,
      section_revisions: this.build_section_revisions(request.projectPath, request.updatedSections),
    };
  }

  private async commit_runtime_change(
    request: RuntimeCommitRequest,
    options: RuntimeCommitOptions = {},
  ): Promise<ProjectWriteResult> {
    const revision_context = request.requireExpectedSectionRevisions
      ? this.write_coordinator.assert_expected_section_revisions(
          request.projectPath,
          request.expectedSectionRevisions,
          request.revisionSections,
        )
      : {
          project_path: request.projectPath,
          meta: this.read_project_meta(request.projectPath),
          sections: request.revisionSections,
        };
    const operations = request.buildOperations(revision_context);
    this.database.execute_transaction(operations);
    const change_request: ProjectWriteChangeRequest = {
      projectPath: request.projectPath,
      source: request.source,
      updatedSections: request.updatedSections,
      ...(request.items === undefined ? {} : { items: request.items }),
      ...(request.files === undefined ? {} : { files: request.files }),
      ...(request.sections === undefined ? {} : { sections: request.sections }),
      ...(request.sectionModes === undefined ? {} : { sectionModes: request.sectionModes }),
    };
    await this.write_coordinator.publish_app_events_for_committed_change(change_request);
    if (options.publishPublic === false) {
      return this.empty_project_write_result();
    }
    return this.write_coordinator.publish_project_data_change(change_request);
  }

  /**
   * 复用写入协调器的空结果，保持无变化写入响应形状一致。
   */
  private empty_project_write_result(): ProjectWriteResult {
    return this.write_coordinator.empty_project_write_result();
  }

  /**
   * 将工作台 asset 操作转换为数据库 workflow 操作。
   */
  private build_asset_operation(project_path: string, write: ProjectAssetWrite): DatabaseOperation {
    if (write.kind === "add_from_source") {
      return this.op("addAssetFromSource", {
        projectPath: project_path,
        path: write.path,
        sourcePath: write.sourcePath,
        sortOrder: write.sortOrder,
      });
    }
    if (write.kind === "update_from_source") {
      return this.op("updateAssetFromSource", {
        projectPath: project_path,
        path: write.path,
        sourcePath: write.sourcePath,
      });
    }
    return this.op("deleteAsset", {
      projectPath: project_path,
      path: write.path,
    });
  }

  private normalize_translation_item_patches(
    value: ApiJsonValue | undefined,
  ): TranslationItemPatch[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new AppErrors.InternalInvariantError({
        diagnostic_context: { reason: "empty_translation_item_patch" },
      });
    }
    const patches: TranslationItemPatch[] = [];
    const seen = new Set<number>();
    for (const raw_item of value) {
      if (!this.is_record(raw_item)) {
        throw new AppErrors.InternalInvariantError({
          diagnostic_context: { reason: "invalid_translation_item_patch" },
        });
      }
      const item_id = this.read_positive_item_id(
        raw_item["item_id"],
        "invalid_translation_item_id",
      );
      if (seen.has(item_id)) {
        throw new AppErrors.InternalInvariantError({
          diagnostic_context: { reason: "duplicate_translation_item_patch", item_id },
        });
      }
      seen.add(item_id);
      const patch: TranslationItemPatch["patch"] = {};
      if (Object.prototype.hasOwnProperty.call(raw_item, "dst")) {
        if (typeof raw_item["dst"] !== "string") {
          throw new AppErrors.InternalInvariantError({
            diagnostic_context: { reason: "invalid_translation_dst", item_id },
          });
        }
        patch.dst = raw_item["dst"];
      }
      if (Object.prototype.hasOwnProperty.call(raw_item, "name_dst")) {
        patch.name_dst = Item.normalize_name(raw_item["name_dst"]);
      }
      if (Object.prototype.hasOwnProperty.call(raw_item, "status")) {
        patch.status = Item.normalize_status(raw_item["status"]);
      }
      if (Object.prototype.hasOwnProperty.call(raw_item, "retry_count")) {
        patch.retry_count = this.read_non_negative_integer_or_throw(
          raw_item["retry_count"],
          "invalid_translation_retry_count",
          item_id,
        );
      }
      if (Object.keys(patch).length === 0) {
        throw new AppErrors.InternalInvariantError({
          diagnostic_context: { reason: "empty_translation_item_patch", item_id },
        });
      }
      patches.push({ item_id, patch });
    }
    return patches;
  }

  private assert_patch_targets_exist(project_path: string, patches: TranslationItemPatch[]): void {
    const rows = this.database.execute(
      this.op("getItemWriteFactsByIds", {
        projectPath: project_path,
        itemIds: patches.map((patch) => patch.item_id) as unknown as DatabaseJsonValue,
      }),
    );
    const existing_ids = new Set<number>();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (this.is_record(row)) {
          const item_id = this.read_number(row["id"], 0);
          if (item_id > 0) {
            existing_ids.add(item_id);
          }
        }
      }
    }
    for (const patch of patches) {
      if (!existing_ids.has(patch.item_id)) {
        throw new AppErrors.InternalInvariantError({
          diagnostic_context: {
            reason: "translation_patch_item_not_found",
            item_id: patch.item_id,
          },
        });
      }
    }
  }

  private to_database_translation_patches(patches: TranslationItemPatch[]): DatabaseJsonValue {
    return patches.map((patch) => ({
      id: patch.item_id,
      patch: patch.patch as unknown as DatabaseJsonValue,
    })) as unknown as DatabaseJsonValue;
  }

  private build_translation_patch_from_items(
    current: MutableJsonRecord,
    next: MutableJsonRecord,
  ): TranslationItemPatch["patch"] {
    const patch: TranslationItemPatch["patch"] = {};
    if (typeof next["dst"] === "string" && next["dst"] !== current["dst"]) {
      patch.dst = next["dst"];
    }
    if (
      Object.prototype.hasOwnProperty.call(next, "name_dst") &&
      next["name_dst"] !== current["name_dst"]
    ) {
      patch.name_dst = Item.normalize_name(next["name_dst"]);
    }
    const status = Item.normalize_status(next["status"]);
    if (status !== current["status"]) {
      patch.status = status;
    }
    const retry_count = Number(next["retry_count"]);
    if (Number.isFinite(retry_count) && retry_count !== Number(current["retry_count"])) {
      patch.retry_count = Math.max(0, Math.trunc(retry_count));
    }
    if (Object.keys(patch).length === 0) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "empty_proofreading_patch" },
      });
    }
    return patch;
  }

  private collect_changed_item_ids(changes: ProofreadingItemChange[]): number[] {
    const item_ids: number[] = [];
    const seen = new Set<number>();
    for (const change of changes) {
      const item_id = this.read_number(change.next["id"], 0);
      if (item_id <= 0 || seen.has(item_id)) {
        continue;
      }
      seen.add(item_id);
      item_ids.push(item_id);
    }
    return item_ids;
  }

  private build_translation_extras_after_status_changes(
    project_path: string,
    revision_context: ProjectWriteRevisionContext,
    changes: ProofreadingItemChange[],
  ): Record<string, unknown> {
    const stored_progress = this.normalize_object(revision_context.meta["translation_extras"]);
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

  private read_translation_progress(meta: JsonRecord): Record<string, unknown> {
    const empty_snapshot = create_empty_translation_task_snapshot();
    return {
      ...this.normalize_object(empty_snapshot["progress"] as ApiJsonValue),
      ...this.normalize_object(meta["translation_extras"]),
    };
  }

  private has_translation_progress_counters(progress: Record<string, unknown>): boolean {
    return (
      this.is_finite_number(progress["total_line"]) &&
      this.is_finite_number(progress["processed_line"]) &&
      this.is_finite_number(progress["error_line"])
    );
  }

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

  private get_translation_status_summary(project_path: string): TranslationProgressCounters {
    const summary = this.normalize_object(
      this.database.execute(this.op("getItemStatusSummary", { projectPath: project_path })),
    );
    const processed_line = this.read_non_negative_integer(summary["processed_line"]);
    const error_line = this.read_non_negative_integer(summary["error_line"]);
    return {
      total_line: this.read_non_negative_integer(summary["total_line"]),
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  private apply_translation_status_deltas(
    counters: TranslationProgressCounters,
    changes: ProofreadingItemChange[],
  ): TranslationProgressCounters {
    let total_line = counters.total_line;
    let processed_line = counters.processed_line;
    let error_line = counters.error_line;
    for (const change of changes) {
      const before = this.count_translation_status(change.current["status"]);
      const after = this.count_translation_status(change.next["status"]);
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

  private count_translation_status(value: ApiJsonValue | undefined): TranslationProgressCounters {
    const status = String(value ?? "");
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

  private build_next_candidate_rows(
    project_path: string,
    glossary_entries: MutableJsonRecord[],
    current_count: number,
  ): { rows: MutableJsonRecord[]; count: number } {
    const normalized_entries = glossary_entries.filter((entry) => {
      const src = String(entry["src"] ?? "").trim();
      const dst = String(entry["dst"] ?? "").trim();
      return src !== "" && dst !== "";
    });
    if (normalized_entries.length === 0) {
      return { rows: [], count: Math.max(0, current_count) };
    }
    const touched_srcs = [
      ...new Set(normalized_entries.map((entry) => String(entry["src"] ?? "").trim())),
    ];
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
      const src = String(entry["src"] ?? "").trim();
      const dst = String(entry["dst"] ?? "").trim();
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
          case_sensitive: Boolean(entry["case_sensitive"] ?? false),
        } as MutableJsonRecord);
      const dst_votes = this.normalize_vote_map(current["dst_votes"]);
      const info_votes = this.normalize_vote_map(current["info_votes"]);
      const info = String(entry["info"] ?? "").trim();
      dst_votes[dst] = this.read_number(dst_votes[dst] as ApiJsonValue, 0) + 1;
      if (info !== "") {
        info_votes[info] = this.read_number(info_votes[info] as ApiJsonValue, 0) + 1;
      }
      current["dst_votes"] = dst_votes as unknown as ApiJsonValue;
      current["info_votes"] = info_votes as unknown as ApiJsonValue;
      current["observation_count"] = this.read_number(current["observation_count"], 0) + 1;
      current["last_seen_at"] = now;
      current["case_sensitive"] =
        Boolean(current["case_sensitive"]) || Boolean(entry["case_sensitive"]);
      aggregate.set(src, current);
    }
    const rows = [...aggregate.values()];
    const next_touched_count = this.count_candidate_entries(rows);
    return {
      rows,
      count: Math.max(0, current_count - previous_touched_count + next_touched_count),
    };
  }

  private count_candidate_entries(rows: MutableJsonRecord[]): number {
    return count_analysis_glossary_candidates(rows);
  }

  private normalize_vote_map(value: ApiJsonValue | undefined): Record<string, number> {
    if (!this.is_record(value)) {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [key, raw_votes] of Object.entries(value)) {
      const text = String(key).trim();
      const votes = this.read_number(raw_votes, 0);
      if (text !== "" && votes > 0) {
        result[text] = (result[text] ?? 0) + votes;
      }
    }
    return result;
  }

  private normalize_checkpoint_rows(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const rows: MutableJsonRecord[] = [];
    for (const raw_row of value) {
      if (!this.is_record(raw_row)) {
        continue;
      }
      const item_id = this.read_number(raw_row["item_id"], 0);
      const status = String(raw_row["status"] ?? "");
      if (item_id <= 0 || !(TASK_PROGRESS_STATUSES as readonly string[]).includes(status)) {
        continue;
      }
      rows.push({
        item_id,
        status,
        updated_at: String(raw_row["updated_at"] ?? new Date().toISOString()),
        error_count: this.read_number(raw_row["error_count"], 0),
      });
    }
    return rows;
  }

  private normalize_error_checkpoint_rows(
    project_path: string,
    value: ApiJsonValue | undefined,
  ): MutableJsonRecord[] {
    const existing = new Map<number, MutableJsonRecord>();
    for (const row of this.get_analysis_checkpoints(project_path)) {
      existing.set(this.read_number(row["item_id"], 0), row);
    }
    const now = new Date().toISOString();
    return this.normalize_checkpoint_rows(value).map((row) => {
      const item_id = this.read_number(row["item_id"], 0);
      const previous = existing.get(item_id);
      const previous_error_count =
        previous?.["status"] === "ERROR" ? this.read_number(previous["error_count"], 0) : 0;
      return {
        ...row,
        status: "ERROR",
        updated_at: now,
        error_count: previous_error_count + 1,
      };
    });
  }

  private normalize_glossary_entries(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const entries: MutableJsonRecord[] = [];
    const seen = new Set<string>();
    for (const raw_entry of value) {
      if (!this.is_record(raw_entry)) {
        continue;
      }
      const src = String(raw_entry["src"] ?? "").trim();
      const dst = String(raw_entry["dst"] ?? "").trim();
      const info = String(raw_entry["info"] ?? "").trim();
      const case_sensitive = Boolean(raw_entry["case_sensitive"] ?? false);
      const key = `${src}\u0000${dst}\u0000${info}\u0000${case_sensitive ? "1" : "0"}`;
      if (src === "" || dst === "" || seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({ src, dst, info, case_sensitive });
    }
    return entries;
  }

  private normalize_nullable_progress_snapshot(
    value: ApiJsonValue | undefined,
  ): MutableJsonRecord | null {
    if (!this.is_record(value)) {
      return null;
    }
    return this.normalize_progress_snapshot(value);
  }

  private normalize_progress_snapshot(value: JsonRecord): MutableJsonRecord {
    return {
      start_time: this.read_float(value["start_time"], 0),
      time: this.read_float(value["time"], 0),
      total_line: this.read_number(value["total_line"], 0),
      line: this.read_number(value["line"], 0),
      processed_line: this.read_number(value["processed_line"], 0),
      error_line: this.read_number(value["error_line"], 0),
      total_tokens: this.read_number(value["total_tokens"], 0),
      total_input_tokens: this.read_number(value["total_input_tokens"], 0),
      total_output_tokens: this.read_number(value["total_output_tokens"], 0),
    };
  }

  private build_analysis_section_delta(
    analysis_extras: MutableJsonRecord,
    candidate_count: number,
  ): MutableJsonRecord {
    const snapshot = this.normalize_progress_snapshot(analysis_extras);
    return {
      extras: snapshot,
      candidate_count: Math.max(0, Math.trunc(candidate_count)),
      status_summary: {
        total_line: this.read_number(snapshot["total_line"], 0),
        processed_line: this.read_number(snapshot["processed_line"], 0),
        error_line: this.read_number(snapshot["error_line"], 0),
        line: this.read_number(snapshot["line"], 0),
      },
    };
  }

  private get_analysis_checkpoints(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(
      this.op("getAnalysisItemCheckpoints", { projectPath: project_path }),
    );
    return Array.isArray(value)
      ? value.filter((row): row is JsonRecord => this.is_record(row)).map((row) => ({ ...row }))
      : [];
  }

  private get_candidate_aggregate_by_srcs(
    project_path: string,
    srcs: string[],
  ): MutableJsonRecord[] {
    const value = this.database.execute(
      this.op("getAnalysisCandidateAggregatesBySrcs", {
        projectPath: project_path,
        srcs: srcs as unknown as DatabaseJsonValue,
      }),
    );
    return Array.isArray(value)
      ? value.filter((row): row is JsonRecord => this.is_record(row)).map((row) => ({ ...row }))
      : [];
  }

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

  private read_project_meta(project_path: string): MutableJsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  private read_positive_item_id(value: ApiJsonValue | undefined, reason: string): number {
    const item_id = this.read_number(value, 0);
    if (!Number.isInteger(item_id) || item_id <= 0) {
      throw new AppErrors.InternalInvariantError({
        diagnostic_context: { reason },
      });
    }
    return item_id;
  }

  private read_non_negative_integer_or_throw(
    value: ApiJsonValue | undefined,
    reason: string,
    item_id: number,
  ): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new AppErrors.InternalInvariantError({
        diagnostic_context: { reason, item_id },
      });
    }
    return Math.trunc(value);
  }

  private is_finite_number(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value);
  }

  private read_non_negative_integer(value: unknown): number {
    const number_value = typeof value === "number" ? value : Number(value ?? 0);
    if (!Number.isFinite(number_value)) {
      return 0;
    }
    return Math.max(0, Math.trunc(number_value));
  }

  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  private read_float(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? number_value : fallback;
  }

  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
