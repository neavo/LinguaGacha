import type { QualityStatisticsTextChangeScope } from "../../shared/project-event";
import type { CacheManager } from "../cache/cache-manager";
import type { PDFDocument } from "../../shared/pdf";
import { ProjectDatabase, type ProjectDatabaseWrite } from "../database/database-operations";
import {
  create_item,
  build_project_item_public_record,
  PROJECT_ITEM_WRITE_SCHEMA,
  type Item,
  type ProjectItemPublicRecord,
} from "../../domain/item";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import {
  read_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";
import {
  is_task_progress_status,
  normalize_batch_translation_progress,
} from "../../domain/batch-translation";
import { normalize_project_settings_snapshot } from "../../domain/setting";

import type {
  ProjectDataSection,
  ProjectDataSectionRevisions,
  ProjectWriteResult,
} from "../../shared/project-event";
import * as AppErrors from "../../shared/error";
import { apply_project_item_field_patch } from "../../shared/project/project-item-update";
import {
  plan_project_item_changes,
  type ProjectItemPlannedChange,
  type ProjectItemWriteRecord,
} from "../../shared/project/project-item-write-planner";
import { create_quality_rule_entry_id } from "../../shared/quality/quality-rule-entry";
import { get_section_revision } from "./project-data-reader";
import type { ProjectChangePublisher } from "./project-write-event-adapter";
import type { ProjectExpectedSectionRevisions } from "./project-write-request";
import type { ProjectItemWriteChange, TranslationItemPatch } from "./project-write-request";
import {
  resolve_project_prompt_storage,
  resolve_project_quality_rule_storage,
  type ProjectTaskInput,
} from "./project-task-input";
import {
  build_project_committed_change,
  type ProjectCommittedChange,
  type ProjectCommittedChangeHandler,
} from "./project-committed-change";
import {
  resolve_agent_workspace_writes,
  has_agent_workspace_applied_changes,
  type AgentWorkspaceIntentBatch,
  type AgentWorkspaceRejectedChange,
  type AgentWorkspaceAppliedSummary,
} from "./agent-workspace-write";
import type { PromptKind } from "../../domain/prompt";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";

type RevisionBackedSection = "files" | "items" | "proofreading" | "pdf";
const PROJECT_ITEM_WRITE_VALIDATOR = Compile(Type.Array(PROJECT_ITEM_WRITE_SCHEMA)); // 全量写入复用编译结果，校验完成后再替换事实。
type ProjectWriteRevisionContext = {
  meta: JsonRecord;
  pendingMeta: MutableJsonRecord;
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
      pdfDocument: PDFDocument | null;
      sortOrder: number;
    }
  | {
      kind: "update_from_source";
      path: string;
      sourcePath: string;
      pdfDocument: PDFDocument | null;
    }
  | {
      kind: "delete";
      path: string;
    };

/** 单次项目事实提交的静态边界与事务内准备函数。 */
type RuntimeCommitRequest = {
  projectPath: string; // 目标 .lg 项目
  expectedSectionRevisions?: ProjectExpectedSectionRevisions; // 快照派生写入的乐观锁
  requireExpectedSectionRevisions: boolean; // 快照派生写入校验 revision，当前事实命令只读取事务内快照
  revisionSections: ProjectDataSection[]; // 参与 revision 校验或推进的候选 section
  source: string; // 公开事件来源
  updatedSections: ProjectDataSection[]; // 静态已知的变化 section
  prepare: (context: ProjectWriteRevisionContext) => RuntimePreparedChange; // 事务内生成实际写入
};

/** 事务内依据当前事实生成的数据库写入和实际事件载荷。 */
type RuntimePreparedChange = {
  itemRecords?: ProjectItemPublicRecord[]; // 全量替换复用已校验输入及数据库分配的主键。
  writes: ProjectDatabaseWrite[]; // 事务内按序执行的数据库操作
  updatedSections?: ProjectDataSection[]; // 事务内确定的实际变化 section
  itemChanges?: readonly ProjectItemWriteChange[]; // 保留前后事实，事务提交时统一确定行 ID 与统计影响。
};

/** 控制公开通知，并把同一提交快照交给任务回执。 */
type RuntimeCommitOptions = {
  onCommitted?: (change: ProjectCommittedChange) => void; // 回执复用事务内修订，避免回读跨越其它事务。
  publishPublic?: boolean; // settings-only 对齐只同步内部缓存
};

/**
 * ProjectWriteSectionAck 是任务 artifact 写入后回传给 engine 的 revision 确认。
 */
export type ProjectWriteSectionAck = {
  changed_item_ids: number[];
  section_revisions: MutableJsonRecord;
};

/** 工程计数按事务内前后状态增量更新，与本轮模型用量分开。 */
type TranslationProgressCounters = {
  total_line: number;
  processed_line: number;
  error_line: number;
  line: number;
};

/** Agent 预演与事务重算共用的领域结果。 */
type AgentWorkspaceWriteOutcome = ReturnType<typeof resolve_agent_workspace_writes>;

/**
 * loaded project 运行态事实的唯一语义写入口。
 */
export class ProjectWriteStore {
  private readonly database: ProjectDatabase; // workflow 是项目事实的物理写入边界

  private readonly apply_committed_change: ProjectCommittedChangeHandler; // 提交后先维护内部 cache 事实

  private readonly project_change_publisher: ProjectChangePublisher | null; // 缓存同步成功后再生成公开变更

  /**
   * 注入唯一数据库写入口、提交结果缓存同步器和可选公开变更发布器。
   */
  public constructor(
    database: ProjectDatabase,
    apply_committed_change: ProjectCommittedChangeHandler,
    project_change_publisher: ProjectChangePublisher | null,
    private readonly cache?: Pick<CacheManager, "readItemWriteScope" | "readFileMetadata">,
  ) {
    this.database = database;
    this.apply_committed_change = apply_committed_change;
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
  public async update_task_progress_meta(request: {
    projectPath: string;
    meta: MutableJsonRecord;
  }): Promise<void> {
    await this.database.transaction(request.projectPath, () => {
      this.database.upsert_meta_entries(request.projectPath, request.meta);
    });
  }

  /** 人工 Item 意图与重复组被动状态在同一事务快照上规划并提交。 */
  public async apply_project_item_changes(request: {
    projectPath: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    source: string;
    itemIds: number[];
    prepareChanges: (
      items: ReadonlyMap<number, ProjectItemWriteRecord>,
    ) => ProjectItemWriteChange[];
  }): Promise<ProjectWriteResult> {
    if (request.itemIds.length === 0) {
      return this.empty_project_write_result();
    }
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      expectedSectionRevisions: request.expectedSectionRevisions,
      requireExpectedSectionRevisions: true,
      revisionSections: ["items", "proofreading"],
      source: request.source,
      updatedSections: ["items", "proofreading"],
      prepare: (revision_context) => {
        const items = this.read_item_write_records(
          request.projectPath,
          revision_context.meta,
          request.itemIds,
        );
        const actual_changes = plan_project_item_changes({
          items,
          explicit_changes: request.prepareChanges(
            new Map(items.map((item) => [item.item_id, item])),
          ),
          duplicate_filter_enabled: this.is_duplicate_filter_enabled(revision_context.meta),
        });
        if (actual_changes.length === 0) return { writes: [], updatedSections: [] };
        const translation_extras = this.has_translation_status_change(actual_changes)
          ? this.build_translation_extras_after_status_changes(
              request.projectPath,
              revision_context,
              actual_changes,
            )
          : null;
        const writes: ProjectDatabaseWrite[] = [
          (database) => database.patch_item_translation_fields(request.projectPath, actual_changes),
        ];
        if (translation_extras !== null) {
          revision_context.pendingMeta["translation_extras"] = translation_extras as JsonValue;
        }
        this.stage_section_revisions(revision_context);
        return {
          writes,
          updatedSections: ["items", "proofreading"],
          itemChanges: actual_changes,
        };
      },
    });
  }

  /**
   * 工作台结构性写入集中提交 asset、items 与 meta。当前事实命令须显式关闭 revision guard。
   */
  public async replace_project_items_and_files(
    request: {
      projectPath: string;
      revisionSections: ProjectDataSection[];
      source: string;
      updatedSections: ProjectDataSection[];
      assetWrites?: ProjectAssetWrite[];
      resetPDFPaths?: string[];
      items?: Item[];
      meta?: MutableJsonRecord;
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
    return await this.commit_runtime_change({
      projectPath: request.projectPath,
      ...(request.expectedSectionRevisions === undefined
        ? {}
        : { expectedSectionRevisions: request.expectedSectionRevisions }),
      requireExpectedSectionRevisions: request.requireExpectedSectionRevisions ?? true,
      revisionSections: request.revisionSections,
      source: request.source,
      updatedSections: request.updatedSections,
      prepare: (revision_context) => {
        const item_records: ProjectItemPublicRecord[] = [];
        const pdf_changed =
          (request.resetPDFPaths?.length ?? 0) > 0 ||
          (request.assetWrites ?? []).some(
            (write) =>
              (write.kind !== "delete" && write.pdfDocument != null) ||
              this.database.read_pdf_document(request.projectPath, write.path) !== null,
          );
        const sections = new Set(request.updatedSections);
        for (const [section, changed] of [
          ["items", request.items !== undefined],
          ["files", (request.assetWrites?.length ?? 0) > 0],
          ["pdf", pdf_changed],
        ] as const) {
          if (changed) sections.add(section);
          else sections.delete(section);
        }
        const updated_sections = [...sections];
        const writes: ProjectDatabaseWrite[] = [];
        if (request.resetPDFPaths?.length)
          writes.push((db) =>
            db.reset_pdf_translations(request.projectPath, request.resetPDFPaths!),
          );
        for (const write of request.assetWrites ?? []) {
          writes.push(this.build_asset_write(request.projectPath, write));
        }
        if (request.items !== undefined) {
          const items = request.items;
          // 全部条目通过完整结构校验后才替换，事务继续保护事实与修订的一致性。
          if (!PROJECT_ITEM_WRITE_VALIDATOR.Check(items)) {
            throw new AppErrors.AppError("request.validation_failed", {
              diagnostic_context: {
                reason: "invalid_project_items",
                errors: PROJECT_ITEM_WRITE_VALIDATOR.Errors(items),
              },
            });
          }
          writes.push((database) => {
            const ids = database.set_items(request.projectPath, items);
            for (const [index, item] of items.entries()) {
              item_records.push(build_project_item_public_record({ ...item, id: ids[index]! }));
            }
            item_records.sort((left, right) => left.item_id - right.item_id); // 与数据库按主键读取的顺序一致。
          });
        }
        if (request.meta !== undefined && Object.keys(request.meta).length > 0) {
          Object.assign(revision_context.pendingMeta, request.meta);
        }

        this.stage_section_revisions({
          ...revision_context,
          sections: updated_sections,
        });
        return {
          writes,
          updatedSections: updated_sections,
          ...(request.items === undefined ? {} : { itemRecords: item_records }),
        };
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
      prepare: (revision_context) => {
        this.stage_section_revisions(revision_context);
        return {
          writes: [
            (database) =>
              database.update_asset_sort_orders(request.projectPath, request.orderedPaths),
          ],
        };
      },
    });
  }

  /**
   * 项目设置镜像提交后同步缓存，公开响应使用空变更语义。
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
        prepare: (context) => {
          Object.assign(context.pendingMeta, request.meta);
          return { writes: [] };
        },
      },
      { publishPublic: false },
    );
  }

  /**
   * 翻译重置提交完整后端生成 item 集合，但提交管线仍统一。
   */
  public async reset_translation_state(request: {
    projectPath: string;
    items: Item[];
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
      prepare: (revision_context) => {
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
          revision_context.pendingMeta[key] = value as unknown as JsonValue;
        }
        revision_context.pendingMeta[request.revisionKey] =
          get_section_revision(revision_context.meta, "quality") + 1;
        return { writes };
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
    text: string | null;
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
      prepare: (revision_context) => {
        revision_context.pendingMeta[request.revisionKey] =
          get_section_revision(revision_context.meta, "prompts") + 1;
        const writes: ProjectDatabaseWrite[] = [
          (database) =>
            database.set_rule_text(request.projectPath, request.promptRuleType, request.text),
        ];
        if (request.enabledMetaKey !== undefined && request.enabled !== undefined) {
          const enabled_meta_key = request.enabledMetaKey;
          const enabled = request.enabled;
          revision_context.pendingMeta[enabled_meta_key] = enabled;
        }
        return { writes };
      },
    });
  }

  /**
   * 一次性应用领域任务输入。物理规则类型、meta key 与 revision 都留在 project 内部。
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
    if (request.input.translation_prompt !== null) {
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
      prepare: (revision_context) => {
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
            revision_context.pendingMeta[enabled_meta_key] = rule.enabled;
          }
          const mode_meta_key = storage.mode_meta_key;
          if (mode_meta_key !== null && rule.mode !== null) {
            revision_context.pendingMeta[mode_meta_key] = rule.mode;
          }
          revision_context.pendingMeta[storage.revision_meta_key] = quality_revision;
        }
        const prompt_revision = get_section_revision(revision_context.meta, "prompts") + 1;
        if (request.input.translation_prompt !== null) {
          const prompt = request.input.translation_prompt;
          const storage = resolve_project_prompt_storage();
          revision_context.pendingMeta[storage.enabled_meta_key] = prompt.enabled;
          revision_context.pendingMeta[storage.revision_meta_key] = prompt_revision;
          writes.push((database) =>
            database.set_rule_text(request.projectPath, storage.database_type, prompt.text),
          );
        }
        return { writes };
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
    let revisions: ProjectDataSectionRevisions = {};
    let actual: AgentWorkspaceWriteOutcome | null = null;
    await this.commit_runtime_change(
      {
        projectPath: request.projectPath,
        requireExpectedSectionRevisions: false,
        revisionSections: [],
        source: request.source,
        updatedSections: [],
        prepare: (revision_context) => {
          const outcome = this.resolve_agent_workspace_changes(request, revision_context.meta);
          actual = outcome;
          const updated_sections = this.build_agent_updated_sections(outcome);
          if (updated_sections.length === 0) return { writes: [], updatedSections: [] };
          return {
            writes: this.build_agent_workspace_writes(
              request.projectPath,
              revision_context,
              outcome,
              updated_sections,
            ),
            updatedSections: updated_sections,
            ...(outcome.itemChanges.length === 0
              ? {}
              : {
                  itemChanges: outcome.itemChanges,
                }),
          };
        },
      },
      {
        onCommitted: (change) => {
          revisions = change.sectionRevisions;
        },
      },
    );
    if (actual === null) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "agent_workspace_outcome_missing" },
      });
    }
    const outcome: AgentWorkspaceWriteOutcome = actual;
    return {
      applied: outcome.applied,
      rejected: outcome.rejected,
      destroyed:
        has_agent_workspace_applied_changes(outcome.applied) ||
        outcome.rejected.some(
          (rejection) =>
            rejection.reason === "fp_mismatch" || rejection.reason === "target_missing",
        ),
      sectionRevisions: revisions,
    };
  }

  /** Agent resolver 在项目事务内读取目标对象，确保指纹、派生状态与写入共享同一事实。 */
  private resolve_agent_workspace_changes(
    request: {
      projectPath: string;
      batch: AgentWorkspaceIntentBatch;
    },
    meta: JsonRecord,
  ): AgentWorkspaceWriteOutcome {
    const items =
      request.batch.items.length === 0
        ? []
        : this.read_item_scope_records(
            request.projectPath,
            meta,
            request.batch.items.map((item) => item.item_id),
          );
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
        const storage = resolve_project_prompt_storage();
        return [kind, this.database.get_rule_text(request.projectPath, storage.database_type)];
      }),
    ) as Partial<Record<PromptKind, string | null>>;
    return resolve_agent_workspace_writes({
      batch: request.batch,
      current: {
        items,
        pdfDocuments: [...new Set(request.batch.pages.map((intent) => intent.file_path))].flatMap(
          (file_path) => {
            const document = this.database.read_pdf_document(request.projectPath, file_path);
            return document ? [{ file_path, document }] : [];
          },
        ),
        quality: Object.fromEntries(
          quality_kinds.map((kind) => [kind, Array.isArray(quality[kind]) ? quality[kind] : []]),
        ),
        prompts,
        duplicateFilterEnabled: this.is_duplicate_filter_enabled(meta),
      },
      createQualityEntryId: create_quality_rule_entry_id,
    });
  }

  /** 只有包含实际变化的 section 才参与 revision、缓存与公开事件。 */
  private build_agent_updated_sections(outcome: AgentWorkspaceWriteOutcome): ProjectDataSection[] {
    const sections: ProjectDataSection[] = [];
    // pages 是 Agent 对象类型，持久化后归 PDF 来源文档所在的数据分区。
    if (outcome.pageChanges.length > 0) sections.push("pdf");
    if (outcome.itemChanges.length > 0) sections.push("items", "proofreading");
    if (outcome.qualityChanges.length > 0) sections.push("quality");
    if (outcome.promptChanges.length > 0) sections.push("prompts");
    return sections;
  }

  /** 将 Agent 的跨 section 实际结果编译为统一提交管线执行的数据库写集合。 */
  private build_agent_workspace_writes(
    project_path: string,
    revision_context: ProjectWriteRevisionContext,
    outcome: AgentWorkspaceWriteOutcome,
    updated_sections: ProjectDataSection[],
  ): ProjectDatabaseWrite[] {
    const writes: ProjectDatabaseWrite[] = [];
    for (const change of outcome.pageChanges)
      writes.push((db) => db.write_pdf_page(project_path, change.file_path, change.page));
    if (outcome.itemChanges.length > 0) {
      writes.push((database) =>
        database.patch_item_translation_fields(project_path, outcome.itemChanges),
      );
      if (this.has_translation_status_change(outcome.itemChanges)) {
        const translation_extras = this.build_translation_extras_after_status_changes(
          project_path,
          { ...revision_context, sections: updated_sections },
          outcome.itemChanges,
        );
        revision_context.pendingMeta["translation_extras"] = translation_extras as JsonValue;
      }
    }
    for (const change of outcome.qualityChanges) {
      const storage = resolve_project_quality_rule_storage(change.kind);
      writes.push((database) =>
        database.set_rules(
          project_path,
          storage.database_type,
          change.entries as unknown as JsonValue[],
        ),
      );
    }
    if (outcome.qualityChanges.length > 0) {
      const quality_revision = get_section_revision(revision_context.meta, "quality") + 1;
      for (const kind of new Set(outcome.qualityChanges.map((change) => change.kind))) {
        const storage = resolve_project_quality_rule_storage(kind);
        revision_context.pendingMeta[storage.revision_meta_key] = quality_revision;
      }
    }
    for (const change of outcome.promptChanges) {
      const storage = resolve_project_prompt_storage();
      writes.push((database) =>
        database.set_rule_text(project_path, storage.database_type, change.text),
      );
    }
    if (outcome.promptChanges.length > 0) {
      const prompt_revision = get_section_revision(revision_context.meta, "prompts") + 1;
      {
        const storage = resolve_project_prompt_storage();
        revision_context.pendingMeta[storage.revision_meta_key] = prompt_revision;
      }
    }
    this.stage_section_revisions({
      ...revision_context,
      sections: updated_sections,
    });
    return writes;
  }

  /**
   * 批次条目和用量共享事务。仅用量或同值结果只写进度。
   */
  private async apply_task_item_patches(request: {
    projectPath: string;
    items: TranslationItemPatch[];
    translationExtras: MutableJsonRecord;
    source: string;
    updatedSections: ProjectDataSection[];
  }): Promise<ProjectWriteSectionAck> {
    const patches = request.items;
    let changed_item_ids: number[] = [];
    let revisions: ProjectDataSectionRevisions = {};
    await this.commit_runtime_change(
      {
        projectPath: request.projectPath,
        requireExpectedSectionRevisions: false,
        revisionSections: request.updatedSections,
        source: request.source,
        updatedSections: request.updatedSections,
        prepare: (revision_context) => {
          // 非空集合在同一事务快照上校验目标并规划变更，空集合跳过条目查询。
          const actual_changes =
            patches.length === 0
              ? []
              : this.plan_item_patch_changes(request.projectPath, revision_context.meta, patches);
          changed_item_ids = actual_changes.map((change) => change.item_id);
          // 工程计数来自事务内的真实状态变化，本次运行用量由任务入口提供。
          const counters = this.build_translation_extras_after_status_changes(
            request.projectPath,
            revision_context,
            actual_changes,
          );
          const translation_extras = {
            ...request.translationExtras,
            total_line: counters["total_line"],
            processed_line: counters["processed_line"],
            error_line: counters["error_line"],
            line: counters["line"],
          };
          revision_context.pendingMeta["translation_extras"] = translation_extras as JsonValue;
          if (actual_changes.length === 0) return { writes: [], updatedSections: [] };
          this.stage_section_revisions(revision_context);
          return {
            writes: [
              (database) =>
                database.patch_item_translation_fields(request.projectPath, actual_changes),
            ],
            itemChanges: actual_changes,
          };
        },
      },
      {
        onCommitted: (change) => {
          revisions = change.sectionRevisions;
        },
      },
    );
    return {
      changed_item_ids,
      section_revisions: Object.fromEntries(
        request.updatedSections.map((section) => [section, revisions[section] ?? 0]),
      ),
    };
  }

  /**
   * 在同一事务内校验并提交。提交后的缓存、公开事件或 ack 读取失败统一标记 committed。
   */
  private async commit_runtime_change(
    request: RuntimeCommitRequest,
    options: RuntimeCommitOptions = {},
  ): Promise<ProjectWriteResult> {
    const committed = await this.database.transaction(request.projectPath, () => {
      // guard、快照和写入必须共享同一个 BEGIN IMMEDIATE，不能给并发提交留下检查后窗口。
      const revision_context = request.requireExpectedSectionRevisions
        ? this.assert_expected_section_revisions(
            request.projectPath,
            request.expectedSectionRevisions,
            request.revisionSections,
          )
        : {
            meta: this.database.get_all_meta(request.projectPath),
            pendingMeta: {},
            sections: request.revisionSections,
          };
      const prepared_change = request.prepare(revision_context);
      const updated_sections = prepared_change.updatedSections ?? request.updatedSections;
      for (const write of prepared_change.writes) write(this.database);
      if (Object.keys(revision_context.pendingMeta).length > 0)
        this.database.upsert_meta_entries(request.projectPath, revision_context.pendingMeta);
      return build_project_committed_change(
        this.database,
        {
          projectPath: request.projectPath,
          source: request.source,
          updatedSections: updated_sections,
          qualityStatisticsScope: this.resolve_quality_statistics_scope(
            prepared_change.itemChanges ?? [],
          ),
          ...(prepared_change.itemChanges === undefined
            ? {}
            : {
                changedItemIds: prepared_change.itemChanges.map((change) => change.item_id),
              }),
        },
        { ...revision_context.meta, ...revision_context.pendingMeta },
        prepared_change.itemRecords,
        prepared_change.itemRecords === undefined && updated_sections.includes("files")
          ? this.cache?.readFileMetadata(
              request.projectPath,
              get_section_revision(revision_context.meta, "items"),
            )
          : undefined,
      );
    });
    // 事务已经提交。后续任一步失败都必须携带能够读取到的最新 revision，禁止调用方重试。
    const committed_section_revisions = committed.sectionRevisions;
    try {
      options.onCommitted?.(committed);
      if (committed.updatedSections.length > 0) await this.apply_committed_change(committed);
      if (options.publishPublic === false) {
        return this.empty_project_write_result();
      }
      return this.publish_project_data_change(committed);
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
    const meta = this.database.get_all_meta(project_path);
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
    return { meta, pendingMeta: {}, sections: [...sections] };
  }

  /**
   * 基于 guard 的同一 meta 快照推进 section revision。
   */
  private stage_section_revisions(
    context: ProjectWriteRevisionContext,
    sections = this.filter_revision_backed_sections(context.sections),
  ): void {
    for (const section of sections)
      context.pendingMeta[this.resolve_revision_meta_key(section)] =
        get_section_revision(context.meta, section) + 1;
  }

  /** 只推进具备独立 revision meta 的 section。 */
  private filter_revision_backed_sections(sections: ProjectDataSection[]): RevisionBackedSection[] {
    return sections.filter(
      (section): section is RevisionBackedSection =>
        section === "files" ||
        section === "items" ||
        section === "proofreading" ||
        section === "pdf",
    );
  }

  /** proofreading 与 runtime section 使用不同 meta key。 */
  private resolve_revision_meta_key(section: RevisionBackedSection): string {
    return section === "proofreading"
      ? "proofreading_revision.proofreading"
      : `project_runtime_revision.${section}`;
  }

  /**
   * 缓存同步完成后才生成公开变更响应。
   */
  private publish_project_data_change(request: ProjectCommittedChange): ProjectWriteResult {
    if (this.project_change_publisher === null || request.updatedSections.length === 0) {
      return this.empty_project_write_result();
    }
    const change_event = this.project_change_publisher(request);
    return change_event === null || change_event === undefined
      ? this.empty_project_write_result()
      : { accepted: true, changes: [change_event] };
  }

  /**
   * 将项目 asset 操作转换为数据库 workflow 操作。
   */
  private build_asset_write(project_path: string, write: ProjectAssetWrite): ProjectDatabaseWrite {
    if (write.kind === "add_from_source") {
      return (database) =>
        database.add_asset_from_source(
          project_path,
          write.path,
          write.sourcePath,
          write.pdfDocument,
          write.sortOrder,
        );
    }
    if (write.kind === "update_from_source") {
      return (database) =>
        database.update_asset_from_source(
          project_path,
          write.path,
          write.sourcePath,
          write.pdfDocument,
        );
    }
    return (database) => database.delete_asset(project_path, write.path);
  }

  /** 缓存缺失或落后时回读全表，事务内事实始终拥有最终解释权。 */
  private read_item_scope_records(
    project: string,
    meta: JsonRecord,
    ids: readonly number[],
  ): JsonRecord[] {
    const scope = this.cache?.readItemWriteScope(project, ids);
    return scope != null && scope.revision === get_section_revision(meta, "items")
      ? this.database.get_items_by_ids(project, scope.ids)
      : this.database.get_all_items(project);
  }

  /** 事务内读取并归一候选 Item，供局部意图和重复组协调共同使用。 */
  private read_item_write_records(
    project_path: string,
    meta: JsonRecord,
    ids: readonly number[],
  ): ProjectItemWriteRecord[] {
    const raw_items = this.read_item_scope_records(project_path, meta, ids);
    return raw_items.flatMap((value) => {
      const item = create_item(value);
      if (item.id === undefined || item.id <= 0) return [];
      return [build_project_item_public_record(item)];
    });
  }

  /** 在事务快照上校验批次目标并计算前后事实，再进入统一重复组写入规划。 */
  private plan_item_patch_changes(
    project_path: string,
    meta: JsonRecord,
    patches: readonly TranslationItemPatch[],
  ): ProjectItemPlannedChange[] {
    const items = this.read_item_write_records(
      project_path,
      meta,
      patches.map((patch) => patch.item_id),
    );
    const current_by_id = new Map(items.map((item) => [item.item_id, item]));
    const explicit_changes = patches.flatMap((item_patch) => {
      const current = current_by_id.get(item_patch.item_id);
      if (current === undefined) {
        throw new AppErrors.AppError("runtime.internal_invariant", {
          diagnostic_context: {
            reason: "translation_patch_item_not_found",
            item_id: item_patch.item_id,
          },
        });
      }
      const next = apply_project_item_field_patch(current, item_patch.patch);
      return next === null ? [] : [{ item_id: item_patch.item_id, current, next }];
    });
    return plan_project_item_changes({
      items,
      explicit_changes,
      duplicate_filter_enabled: this.is_duplicate_filter_enabled(meta),
    });
  }

  /** 项目 meta 优先于旧 prefilter 镜像，读取当前重复过滤设置。 */
  private is_duplicate_filter_enabled(meta: JsonRecord): boolean {
    return normalize_project_settings_snapshot(
      meta,
      normalize_project_settings_snapshot(read_json_record(meta["prefilter_config"])),
    ).skip_duplicate_source_text_enable;
  }

  /** 状态和译名不参与质量文本统计，正文实际变化只影响译后规则。 */
  private resolve_quality_statistics_scope(
    changes: readonly ProjectItemWriteChange[],
  ): QualityStatisticsTextChangeScope {
    return changes.some(({ current, next }) => current.dst !== next.dst)
      ? "post_replacement"
      : "none";
  }

  /** 翻译统计只由状态变化驱动，调用方不再传递派生布尔值。 */
  private has_translation_status_change(changes: readonly ProjectItemWriteChange[]): boolean {
    return changes.some(({ current, next }) => current.status !== next.status);
  }

  /**
   * 优先沿用可信持久计数。旧项目缺失计数时从数据库摘要补齐，再应用状态增量。
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
    return {
      ...normalize_batch_translation_progress(undefined),
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
