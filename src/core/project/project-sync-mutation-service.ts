import type { ApiJsonValue } from "../api/api-types";
import type { AppSettingService } from "../app/app-setting-service";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import { FileFormatService } from "../file/file-format-service";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import { ProjectMutationCoordinator } from "./project-mutation-coordinator";
import type { ProjectOperationGate } from "./project-operation-gate";
import { get_runtime_section_revision } from "./project-section-revision";
import { ProjectSessionState } from "./project-session-state";
import {
  Item,
  collect_project_item_missing_public_fields,
  normalize_project_item_persistent_record,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "../../base/item";
import {
  normalize_project_settings_snapshot,
  normalize_setting_snapshot,
  type ProjectSettingsSnapshot,
} from "../../base/setting";
import type { ProjectChangePublisher } from "./project-change-publisher";
import type { ProjectDataSection, ProjectMutationResult } from "../../shared/project/event";
import {
  build_analysis_progress_snapshot,
  build_analysis_status_summary,
  build_item_view_map,
  build_public_item_map,
  build_translation_extras_from_items,
  compute_project_prefilter_mutation,
  create_empty_translation_task_snapshot,
  derive_project_item_view_record,
  normalize_analysis_progress_snapshot,
  type ProjectPrefilterMutationOutput,
} from "./project-mutation-state";
import { is_task_skipped_item_status } from "../../shared/task";
import * as AppErrors from "../../shared/error";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

type ProjectMutationSettings = ProjectSettingsSnapshot; // 同步 mutation 只消费设置领域定义的项目镜像窄字段

type AddWorkbenchFileCommand = {
  source_path: string; // source_path 是用户选中的真实文件路径，只允许慢准备阶段读取
  target_rel_path: string; // target_rel_path 是写入 .lg asset 的相对路径，提交阶段重新做唯一性校验
};

type AddWorkbenchFileDraft = AddWorkbenchFileCommand & {
  parsed_items: JsonRecord[]; // parsed_items 是格式解析产物，不携带 item id 或当前项目快照
  file_type: string; // file_type 只来自解析结果，提交阶段再绑定 asset 顺序
};

type TranslationResetParsedItemDraft = {
  identity_key: string; // identity_key 只表达解析条目的稳定身份，不绑定当前 item id
  identity_item: JsonRecord; // identity_item 是重解析后的公开字段底稿，提交阶段再补当前 id
};

/**
 * 承载项目同步 mutation，把 API Gateway 的业务写入收口到 ProjectDatabase 窄操作
 */
export class ProjectSyncMutationService {
  private readonly database: ProjectDatabase; // 所有 .lg 写入必须经由 ProjectDatabase workflow，避免项目域直接碰 SQL

  private readonly project_operation_gate: ProjectOperationGate; // 结构性 mutation 与任务启动统一经由后端互斥门闩

  private readonly session_state: ProjectSessionState; // 当前公开工程路径由 API Gateway 会话状态提供，避免同步 mutation 回读旧缓存

  private readonly mutation_coordinator: ProjectMutationCoordinator; // 同步 mutation 的 revision guard、bump 和 canonical 事件统一经由协调器

  private readonly app_setting_service: AppSettingService | null; // 文件重解析需要当前应用级格式配置；测试可为空并使用稳定默认值

  private readonly native_fs: NativeFs; // native_fs 只用于显式项目路径存在性校验，.lg 写入仍归 ProjectDatabase

  /**
   * 注入 database、互斥门闩和会话状态，保持写库边界可测试
   */
  public constructor(
    database: ProjectDatabase,
    project_operation_gate: ProjectOperationGate,
    session_state: ProjectSessionState,
    project_change_publisher: ProjectChangePublisher | null = null,
    app_setting_service: AppSettingService | null = null,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.database = database;
    this.project_operation_gate = project_operation_gate;
    this.session_state = session_state;
    this.mutation_coordinator = new ProjectMutationCoordinator(database, project_change_publisher);
    this.app_setting_service = app_setting_service;
    this.native_fs = native_fs;
  }

  /**
   * 新增工作台文件，并同步重建 items 与分析派生 meta
   */
  public async add_workbench_file(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    return this.project_operation_gate.run_exclusive_project_mutation(async () => {
      const file_commands = this.normalize_add_file_commands(request["files"]);
      if (file_commands.length === 0) {
        throw new AppErrors.RequestValidationError();
      }
      const file_drafts = await this.parse_add_file_commands(file_commands);

      return this.mutation_coordinator.commit_project_mutation({
        projectPath: project_path,
        expectedSectionRevisions: request["expected_section_revisions"],
        sections: ["files", "items", "analysis"],
        buildOperations: (revision_context) => {
          const asset_records = this.get_asset_records(project_path); // 提交点重新读取当前 asset，路径冲突以最新数据库事实为准
          const existing_paths = new Set(asset_records.map((record) => record.path.toLowerCase()));
          const incoming_paths = new Set<string>();
          const current_items = this.to_public_items_by_id(this.get_all_items(project_path));
          const current_files = this.build_file_section_from_asset_records(
            project_path,
            asset_records,
          );
          const next_items = new Map(current_items);
          const old_items = [...current_items.values()];
          const added_item_ids: number[] = [];
          const normalized_files: Array<{
            source_path: string;
            target_rel_path: string;
            file_record: { rel_path: string; file_type: string; sort_index: number };
          }> = [];
          let next_item_id = this.next_item_id_seed(current_items);
          for (const [index, file] of file_drafts.entries()) {
            const target_key = file.target_rel_path.toLowerCase();
            if (existing_paths.has(target_key) || incoming_paths.has(target_key)) {
              throw new AppErrors.DatabaseConflictError({
                public_details: {
                  rel_path: file.target_rel_path,
                },
              });
            }
            incoming_paths.add(target_key);
            const file_record = {
              rel_path: file.target_rel_path,
              file_type: file.file_type,
              sort_index: asset_records.length + index,
            };
            current_files[file_record.rel_path] = file_record;
            for (const parsed_item of file.parsed_items) {
              next_item_id += 1;
              const public_item = this.normalize_public_item({
                ...Item.from_json(parsed_item).to_json(),
                id: next_item_id,
                file_path: file.target_rel_path,
              });
              next_items.set(public_item.item_id, public_item);
              added_item_ids.push(public_item.item_id);
            }
            normalized_files.push({
              source_path: file.source_path,
              target_rel_path: file.target_rel_path,
              file_record,
            });
          }

          const settings = this.read_project_mutation_settings(
            project_path,
            request["project_settings"],
          );
          let mutation_output = this.compute_prefilter_output({
            project_path,
            files: current_files,
            items: this.public_item_record_from_map(next_items),
            settings,
          });
          if (String(request["inheritance_mode"] ?? "none") === "inherit") {
            const inherited_items = this.clone_public_item_record(mutation_output.items);
            this.inherit_completed_translations({
              old_items,
              next_items: added_item_ids.flatMap((item_id) => {
                const item = inherited_items[String(item_id)];
                return item === undefined ? [] : [item];
              }),
            });
            mutation_output = this.compute_prefilter_output({
              project_path,
              files: current_files,
              items: inherited_items,
              settings,
            });
          }

          const operations: DatabaseOperation[] = [];
          for (const file of normalized_files) {
            operations.push(
              this.op("addAssetFromSource", {
                projectPath: project_path,
                path: file.target_rel_path,
                sourcePath: file.source_path,
                sortOrder: file.file_record.sort_index,
              }),
            );
          }
          operations.push(
            this.op("setItems", {
              projectPath: project_path,
              items: this.persistent_items_from_public_record(mutation_output.items),
            }),
            this.op("upsertMetaEntries", {
              projectPath: project_path,
              meta: this.build_prefilter_reset_meta(settings, mutation_output),
            }),
            this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
            this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
            ...this.mutation_coordinator.build_section_revision_operations(revision_context),
          );
          return operations;
        },
        change: {
          source: "workbench_add_file",
          updatedSections: ["files", "items", "analysis"],
        },
      });
    });
  }

  /**
   * 重置指定工作台文件的条目事实，并清空分析状态
   */
  public async reset_workbench_file(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    return this.project_operation_gate.run_exclusive_project_mutation(async () => {
      const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
        project_path,
        request["expected_section_revisions"],
        ["items", "analysis"],
      );
      this.assert_no_legacy_fields(request, [
        "items",
        "translation_extras",
        "prefilter_config",
        "analysis_extras",
      ]);
      const rel_paths = this.normalize_string_list(request["rel_paths"]);
      this.assert_rel_paths_exist(project_path, rel_paths);
      const rel_path_set = new Set(rel_paths);
      const items = this.to_public_item_record(this.get_all_items(project_path));
      for (const item of Object.values(items)) {
        if (!rel_path_set.has(item.file_path)) {
          continue;
        }
        item.dst = "";
        item.name_dst = null;
        item.status = "NONE";
        item.retry_count = 0;
      }
      const settings = this.read_project_mutation_settings(
        project_path,
        request["project_settings"],
      );
      const mutation_output = this.compute_prefilter_output({
        project_path,
        files: this.build_file_section_from_asset_records(project_path),
        items,
        settings,
      });
      this.database.execute_transaction([
        this.op("setItems", {
          projectPath: project_path,
          items: this.persistent_items_from_public_record(mutation_output.items),
        }),
        this.op("upsertMetaEntries", {
          projectPath: project_path,
          meta: this.build_prefilter_reset_meta(settings, mutation_output),
        }),
        this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
        this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
        ...this.mutation_coordinator.build_section_revision_operations(revision_context),
      ]);
      return this.mutation_coordinator.publish_project_data_change({
        projectPath: project_path,
        source: "workbench_reset_file",
        updatedSections: ["items", "analysis"],
      });
    });
  }

  /**
   * 删除工作台文件与对应条目，并清空分析状态
   */
  public async delete_workbench_file(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    return this.project_operation_gate.run_exclusive_project_mutation(async () => {
      const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
        project_path,
        request["expected_section_revisions"],
        ["files", "items", "analysis"],
      );
      this.assert_no_legacy_fields(request, [
        "items",
        "translation_extras",
        "prefilter_config",
        "analysis_extras",
      ]);
      const rel_paths = this.normalize_string_list(request["rel_paths"]);
      this.assert_rel_paths_exist(project_path, rel_paths);
      const rel_path_set = new Set(rel_paths);
      const files = this.build_file_section_from_asset_records(project_path);
      for (const rel_path of rel_paths) {
        delete files[rel_path];
      }
      const items = this.to_public_item_record(this.get_all_items(project_path));
      for (const item_id of Object.keys(items)) {
        const item = items[item_id];
        if (item !== undefined && rel_path_set.has(item.file_path)) {
          delete items[item_id];
        }
      }
      const settings = this.read_project_mutation_settings(
        project_path,
        request["project_settings"],
      );
      const mutation_output = this.compute_prefilter_output({
        project_path,
        files,
        items,
        settings,
      });
      const operations: DatabaseOperation[] = [];
      for (const rel_path of rel_paths) {
        operations.push(this.op("deleteAsset", { projectPath: project_path, path: rel_path }));
      }
      operations.push(
        this.op("setItems", {
          projectPath: project_path,
          items: this.persistent_items_from_public_record(mutation_output.items),
        }),
        this.op("upsertMetaEntries", {
          projectPath: project_path,
          meta: this.build_prefilter_reset_meta(settings, mutation_output),
        }),
        this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
        this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
        ...this.mutation_coordinator.build_section_revision_operations(revision_context),
      );
      this.database.execute_transaction(operations);
      return this.mutation_coordinator.publish_project_data_change({
        projectPath: project_path,
        source: "workbench_delete_file",
        updatedSections: ["files", "items", "analysis"],
      });
    });
  }

  /**
   * 持久化完整文件顺序，确保拖拽重排只影响 files section
   */
  public async reorder_workbench_files(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    return this.project_operation_gate.run_exclusive_project_mutation(async () => {
      const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
        project_path,
        request["expected_section_revisions"],
        ["files"],
      );
      const ordered_paths = this.normalize_string_list(request["ordered_rel_paths"]);
      const current_paths = this.get_asset_records(project_path).map((record) => record.path);
      this.assert_complete_path_order(current_paths, ordered_paths);
      this.database.execute_transaction([
        this.op("updateAssetSortOrders", {
          projectPath: project_path,
          orderedPaths: ordered_paths,
        }),
        ...this.mutation_coordinator.build_section_revision_operations(revision_context),
      ]);
      return this.mutation_coordinator.publish_project_data_change({
        projectPath: project_path,
        source: "workbench_reorder_files",
        updatedSections: ["files"],
      });
    });
  }

  /**
   * 写入项目设置镜像；prefiltered_items 模式同时替换条目与分析派生状态
   */
  public async apply_settings_alignment(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.resolve_project_path(request);
    const mode = String(request["mode"] ?? "").toLowerCase();
    const settings_meta = this.build_project_settings_only_meta(request["project_settings"]);
    if (mode === "settings_only") {
      this.database.execute_transaction([
        this.op("upsertMetaEntries", { projectPath: project_path, meta: settings_meta }),
      ]);
      return this.mutation_coordinator.empty_project_mutation_result();
    }
    if (mode !== "prefiltered_items") {
      throw new AppErrors.RequestValidationError();
    }
    return this.project_operation_gate.run_exclusive_project_mutation(() => {
      this.assert_no_legacy_fields(request, ["items", "translation_extras", "prefilter_config"]);
      const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
        project_path,
        request["expected_section_revisions"],
        ["items", "analysis"],
      );
      const settings = this.read_project_mutation_settings(
        project_path,
        request["project_settings"],
      );
      const mutation_output = this.compute_prefilter_output({
        project_path,
        files: this.build_file_section_from_asset_records(project_path),
        items: this.to_public_item_record(this.get_all_items(project_path)),
        settings,
      });
      this.database.execute_transaction([
        this.op("setItems", {
          projectPath: project_path,
          items: this.persistent_items_from_public_record(mutation_output.items),
        }),
        this.op("upsertMetaEntries", {
          projectPath: project_path,
          meta: {
            ...settings_meta,
            ...this.build_prefilter_reset_meta(settings, mutation_output),
          },
        }),
        this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
        this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
        ...this.mutation_coordinator.build_section_revision_operations(revision_context),
      ]);
      return this.mutation_coordinator.publish_project_data_change({
        projectPath: project_path,
        source: "settings_alignment",
        updatedSections: ["items", "analysis"],
      });
    });
  }

  /**
   * 提交翻译重置结果，保持 all 与 failed 两种旧语义分离
   */
  public async apply_translation_reset(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const mode = String(request["mode"] ?? "").toLowerCase();
    this.assert_no_legacy_fields(request, ["items", "translation_extras", "prefilter_config"]);
    return this.project_operation_gate.run_exclusive_project_mutation(async () => {
      if (mode === "all") {
        const reset_item_drafts = await this.reparse_all_asset_identity_items(project_path);
        return this.mutation_coordinator.commit_project_mutation({
          projectPath: project_path,
          expectedSectionRevisions: request["expected_section_revisions"],
          sections: ["items", "analysis"],
          buildOperations: (revision_context) => {
            const settings = this.read_project_mutation_settings(
              project_path,
              request["project_settings"],
            );
            const reset_items = this.bind_reset_all_items_to_current_ids(
              project_path,
              reset_item_drafts,
            );
            const mutation_output = this.compute_prefilter_output({
              project_path,
              files: this.build_file_section_from_asset_records(project_path),
              items: this.public_item_record_from_array(reset_items),
              settings,
              task_snapshot: create_empty_translation_task_snapshot(),
            });
            return [
              this.op("setItems", {
                projectPath: project_path,
                items: this.persistent_items_from_public_record(mutation_output.items),
              }),
              this.op("upsertMetaEntries", {
                projectPath: project_path,
                meta: this.build_prefilter_reset_meta(settings, mutation_output),
              }),
              this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
              this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
              ...this.mutation_coordinator.build_section_revision_operations(revision_context),
            ];
          },
          change: {
            source: "translation_reset",
            updatedSections: ["items", "analysis"],
          },
        });
      }
      if (mode === "failed") {
        const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
          project_path,
          request["expected_section_revisions"],
          ["items"],
        );
        const items = this.to_public_item_record(this.get_all_items(project_path));
        for (const item of Object.values(items)) {
          if (item.status !== "ERROR") {
            continue;
          }
          item.dst = "";
          item.name_dst = null;
          item.status = "NONE";
          item.retry_count = 0;
        }
        const translation_extras = this.build_translation_extras_for_items(project_path, items);
        this.database.execute_transaction([
          this.op("setItems", {
            projectPath: project_path,
            items: this.persistent_items_from_public_record(items),
          }),
          this.op("upsertMetaEntries", {
            projectPath: project_path,
            meta: {
              translation_extras: translation_extras as unknown as DatabaseJsonValue,
            },
          }),
          ...this.mutation_coordinator.build_section_revision_operations(revision_context),
        ]);
        return this.mutation_coordinator.publish_project_data_change({
          projectPath: project_path,
          source: "translation_reset",
          updatedSections: ["items"],
        });
      }
      throw new AppErrors.RequestValidationError();
    });
  }

  /**
   * 提交分析重置结果，all 清空全部分析事实，failed 只清失败 checkpoint
   */
  public async apply_analysis_reset(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    const mode = String(request["mode"] ?? "").toLowerCase();
    this.assert_no_legacy_fields(request, ["analysis_extras"]);
    return this.project_operation_gate.run_exclusive_project_mutation(() => {
      const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
        project_path,
        request["expected_section_revisions"],
        ["analysis"],
      );
      const analysis_extras = this.build_analysis_reset_extras(project_path, mode);
      const operations: DatabaseOperation[] = [
        this.op("upsertMetaEntries", {
          projectPath: project_path,
          meta: {
            analysis_extras: analysis_extras as unknown as DatabaseJsonValue,
            ...(mode === "all" ? { analysis_candidate_count: 0 } : {}),
          },
        }),
      ];
      if (mode === "all") {
        operations.push(
          this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
          this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
        );
      } else if (mode === "failed") {
        operations.push(
          this.op("deleteAnalysisItemCheckpoints", {
            projectPath: project_path,
            status: "ERROR",
          }),
        );
      } else {
        throw new AppErrors.RequestValidationError();
      }
      operations.push(
        ...this.mutation_coordinator.build_section_revision_operations(revision_context),
      );
      this.database.execute_transaction(operations);
      return this.mutation_coordinator.publish_project_data_change({
        projectPath: project_path,
        source: "analysis_reset",
        updatedSections: ["analysis"],
      });
    });
  }

  /**
   * 写入术语导入结果，同时对齐 quality 与 analysis revision
   */
  public async import_analysis_glossary(request: JsonRecord): Promise<ProjectMutationResult> {
    const project_path = await this.require_loaded_project_path();
    this.assert_no_legacy_fields(request, [
      "analysis_candidate_count",
      "expected_glossary_revision",
    ]);
    const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
      project_path,
      request["expected_section_revisions"],
      ["analysis", "quality"],
    );
    const current_quality_revision = get_runtime_section_revision(revision_context.meta, "quality");
    const next_rules = this.normalize_rule_entries(request["entries"]);
    const quality_changed = !this.are_rule_entries_equal(
      this.get_rule_entries(project_path, "glossary"),
      next_rules,
    );
    const updated_sections: ProjectDataSection[] = quality_changed
      ? ["quality", "analysis"]
      : ["analysis"];
    const consumed_candidate_srcs = this.normalize_string_list(request["consumed_candidate_srcs"]);
    // 候选数是后端 meta 派生事实，只能根据数据库当前聚合和本次消费列表计算
    const analysis_candidate_count = this.count_remaining_analysis_candidates(
      project_path,
      consumed_candidate_srcs,
    );
    const operations: DatabaseOperation[] = [
      ...(quality_changed
        ? [
            this.op("setRules", {
              projectPath: project_path,
              ruleType: "glossary",
              rules: next_rules,
            }),
            this.op("setMeta", {
              projectPath: project_path,
              key: "quality_rule_revision.glossary",
              value: current_quality_revision + 1,
            }),
          ]
        : []),
      this.op("deleteAnalysisCandidateAggregatesBySrcs", {
        projectPath: project_path,
        srcs: consumed_candidate_srcs,
      }),
      this.op("setMeta", {
        projectPath: project_path,
        key: "analysis_candidate_count",
        value: analysis_candidate_count,
      }),
      ...this.mutation_coordinator.build_section_revision_operations(revision_context, [
        "analysis",
      ]),
    ];
    this.database.execute_transaction(operations);
    return this.mutation_coordinator.publish_project_data_change({
      projectPath: project_path,
      source: "analysis_glossary_import",
      updatedSections: updated_sections,
    });
  }

  /**
   * 工作台新增文件 command 只承载用户意图；解析、id、预过滤和继承都在 Core 侧完成
   */
  private normalize_add_file_commands(value: ApiJsonValue | undefined): AddWorkbenchFileCommand[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => this.is_record(item))
      .map((item) => {
        this.assert_no_legacy_fields(item, ["file_record", "parsed_items"]);
        return {
          source_path: String(item["source_path"] ?? "").trim(),
          target_rel_path: String(item["target_rel_path"] ?? "").trim(),
        };
      })
      .filter((item) => item.source_path !== "" && item.target_rel_path !== "");
  }

  /**
   * 慢准备阶段只读取用户源文件并解析格式，不读取当前项目 meta、items 或 asset 集合
   */
  private async parse_add_file_commands(
    file_commands: AddWorkbenchFileCommand[],
  ): Promise<AddWorkbenchFileDraft[]> {
    const format_service = this.create_format_service();
    const file_drafts: AddWorkbenchFileDraft[] = [];
    for (const file of file_commands) {
      const parsed_items = await format_service.parse_asset(
        file.target_rel_path,
        this.native_fs.read_file(file.source_path),
      );
      file_drafts.push({
        ...file,
        parsed_items: parsed_items.map((item) => Item.from_json(item).to_json()),
        file_type: format_service.pick_file_type(parsed_items),
      });
    }
    return file_drafts;
  }

  /**
   * 旧 payload 字段出现时直接拒绝，避免 renderer 事实生成路径继续悄悄可用
   */
  private assert_no_legacy_fields(request: JsonRecord, fields: string[]): void {
    for (const field of fields) {
      if (field in request) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "legacy_payload_field", field },
        });
      }
    }
  }

  /**
   * 文件解析必须跟随当前应用格式配置；没有配置服务的单测使用稳定默认值
   */
  private create_format_service(): FileFormatService {
    const config = normalize_setting_snapshot(this.app_setting_service?.read_setting() ?? {});
    return new FileFormatService(
      {
        source_language: config.source_language,
        target_language: config.target_language,
        app_language: config.app_language,
        deduplication_in_bilingual: config.deduplication_in_bilingual,
        write_translated_name_fields_to_file: config.write_translated_name_fields_to_file,
      },
      this.native_fs,
    );
  }

  /**
   * mutation 计算优先读取请求中的用户设置；缺失时回到项目 meta 镜像
   */
  private read_project_mutation_settings(
    project_path: string,
    value: ApiJsonValue | undefined,
  ): ProjectMutationSettings {
    const request_settings = this.normalize_object(value);
    const meta = this.get_all_meta(project_path);
    const prefilter_config = this.normalize_object(meta["prefilter_config"]);
    return normalize_project_settings_snapshot(
      request_settings,
      normalize_project_settings_snapshot(
        meta,
        normalize_project_settings_snapshot(prefilter_config),
      ),
    );
  }

  /**
   * 从 asset 与 item 当前事实构建预过滤输入中的 files section
   */
  private build_file_section_from_asset_records(
    project_path: string,
    asset_records: Array<{ path: string; sort_order: number }> = this.get_asset_records(
      project_path,
    ),
  ): Record<string, { rel_path: string; file_type: string; sort_index: number }> {
    const file_type_by_path = new Map<string, string>();
    for (const item of this.get_all_items(project_path)) {
      const rel_path = String(item["file_path"] ?? "");
      if (rel_path !== "" && !file_type_by_path.has(rel_path)) {
        file_type_by_path.set(rel_path, String(item["file_type"] ?? "NONE"));
      }
    }
    const files: Record<string, { rel_path: string; file_type: string; sort_index: number }> = {};
    for (const record of asset_records) {
      files[record.path] = {
        rel_path: record.path,
        file_type: file_type_by_path.get(record.path) ?? "NONE",
        sort_index: record.sort_order,
      };
    }
    return files;
  }

  /**
   * 数据库持久 item 先升格为公开 DTO，后续算法不再接触 id/row 内部字段
   */
  private to_public_items_by_id(items: MutableJsonRecord[]): Map<number, ProjectItemPublicRecord> {
    const public_items = new Map<number, ProjectItemPublicRecord>();
    for (const item of items) {
      const public_item = normalize_project_item_public_record(item);
      if (public_item !== null) {
        public_items.set(public_item.item_id, { ...public_item });
      }
    }
    return public_items;
  }

  /**
   * 以 record 形状传给后端预过滤工具，key 固定为公开 item_id
   */
  private to_public_item_record(
    items: MutableJsonRecord[],
  ): Record<string, ProjectItemPublicRecord> {
    return this.public_item_record_from_map(this.to_public_items_by_id(items));
  }

  /**
   * Map 形状的公开 item 索引转为 record，保持后端预过滤工具输入稳定
   */
  private public_item_record_from_map(
    items: Map<number, ProjectItemPublicRecord>,
  ): Record<string, ProjectItemPublicRecord> {
    const record: Record<string, ProjectItemPublicRecord> = {};
    for (const item of items.values()) {
      record[String(item.item_id)] = { ...item };
    }
    return record;
  }

  /**
   * 数组形状的公开 item 集合转为 record，用于 reset-all 重新解析结果
   */
  private public_item_record_from_array(
    items: ProjectItemPublicRecord[],
  ): Record<string, ProjectItemPublicRecord> {
    const record: Record<string, ProjectItemPublicRecord> = {};
    for (const item of items) {
      record[String(item.item_id)] = { ...item };
    }
    return record;
  }

  /**
   * 新解析 item 必须立刻拥有完整公开 DTO，避免后续预过滤和继承处理半成品
   */
  private normalize_public_item(value: unknown): ProjectItemPublicRecord {
    const public_item = normalize_project_item_public_record(value);
    if (public_item === null) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: {
          reason: "item_incomplete",
          missing_fields: collect_project_item_missing_public_fields(value),
        },
      });
    }
    return public_item;
  }

  /**
   * 写库前统一把公开 DTO 转回持久字段，防止调用点手写 id/row 映射
   */
  private persistent_items_from_public_record(
    items: Record<string, ProjectItemPublicRecord>,
  ): MutableJsonRecord[] {
    return Object.values(items)
      .sort((left, right) => left.item_id - right.item_id)
      .map((item) => {
        const persistent_item = normalize_project_item_persistent_record(item);
        if (persistent_item === null) {
          throw new AppErrors.RequestValidationError({
            diagnostic_context: {
              reason: "item_incomplete",
              missing_fields: collect_project_item_missing_public_fields(item),
            },
          });
        }
        return persistent_item as MutableJsonRecord;
      });
  }

  /**
   * 预过滤输出由后端基于当前数据库事实计算，renderer 不再提交最终 items 或 meta
   */
  private compute_prefilter_output(args: {
    project_path: string;
    files: Record<string, unknown>;
    items: Record<string, ProjectItemPublicRecord>;
    settings: ProjectMutationSettings;
    task_snapshot?: Record<string, unknown>;
  }): ProjectPrefilterMutationOutput {
    return compute_project_prefilter_mutation({
      state: {
        files: args.files,
        items: args.items,
      },
      task_snapshot:
        args.task_snapshot ?? this.build_translation_task_snapshot_from_meta(args.project_path),
      source_language: args.settings.source_language,
      target_language: args.settings.target_language,
      mtool_optimizer_enable: args.settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: args.settings.skip_duplicate_source_text_enable,
    });
  }

  /**
   * 预过滤类 mutation 固定重置分析派生事实，并写入当前项目设置镜像
   */
  private build_prefilter_reset_meta(
    settings: ProjectMutationSettings,
    output: ProjectPrefilterMutationOutput,
  ): MutableJsonRecord {
    return {
      source_language: settings.source_language,
      target_language: settings.target_language,
      mtool_optimizer_enable: settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: settings.skip_duplicate_source_text_enable,
      prefilter_config: output.prefilter_config as unknown as ApiJsonValue,
      translation_extras: output.translation_extras as unknown as ApiJsonValue,
      analysis_extras: {},
      analysis_candidate_count: 0,
    };
  }

  /**
   * 从数据库 translation_extras 恢复任务进度基底，后续统计会覆盖行数
   */
  private build_translation_task_snapshot_from_meta(project_path: string): Record<string, unknown> {
    return {
      ...create_empty_translation_task_snapshot(),
      progress: this.normalize_object(this.get_all_meta(project_path)["translation_extras"]),
    };
  }

  /**
   * 新增 item id 从当前最大公开 id 之后递增，避免与既有数据库事实冲突
   */
  private next_item_id_seed(items: Map<number, ProjectItemPublicRecord>): number {
    let seed = 0;
    for (const item_id of items.keys()) {
      seed = Math.max(seed, item_id);
    }
    return seed;
  }

  /**
   * 复制公开 item record，继承写入不能污染第一次预过滤结果
   */
  private clone_public_item_record(
    items: Record<string, ProjectItemPublicRecord>,
  ): Record<string, ProjectItemPublicRecord> {
    return Object.fromEntries(
      Object.entries(items).map(([item_id, item]) => [item_id, { ...item }]),
    );
  }

  /**
   * 将新解析条目按原文继承旧已完成译文，候选选择只在后端执行
   */
  private inherit_completed_translations(args: {
    old_items: ProjectItemPublicRecord[];
    next_items: ProjectItemPublicRecord[];
  }): void {
    const candidate_map = this.build_translation_inheritance_candidates(args.old_items);
    for (const item of args.next_items) {
      if (Item.normalize_status(item.status) !== "NONE") {
        continue;
      }
      const candidates = candidate_map.get(item.src);
      if (candidates === undefined || candidates.length === 0) {
        continue;
      }
      const candidate = candidates[0];
      item.dst = candidate.dst;
      item.name_dst = candidate.name_dst;
      item.retry_count = candidate.retry_count;
      item.status = candidate.status;
    }
  }

  /**
   * 按原文聚合可继承译文，优先选择出现次数最多且最早出现的候选
   */
  private build_translation_inheritance_candidates(old_items: ProjectItemPublicRecord[]): Map<
    string,
    Array<{
      dst: string;
      name_dst: ProjectItemPublicRecord["name_dst"];
      retry_count: number;
      status: ProjectItemPublicRecord["status"];
      count: number;
      first_index: number;
    }>
  > {
    const src_candidates = new Map<
      string,
      Map<
        string,
        {
          dst: string;
          name_dst: ProjectItemPublicRecord["name_dst"];
          retry_count: number;
          status: ProjectItemPublicRecord["status"];
          count: number;
          first_index: number;
        }
      >
    >();
    let global_index = 0;
    for (const item of old_items) {
      const status = Item.normalize_status(item.status);
      if (status !== "PROCESSED" || item.dst.trim() === "") {
        global_index += 1;
        continue;
      }
      const candidates_by_dst = src_candidates.get(item.src) ?? new Map();
      const existing_candidate = candidates_by_dst.get(item.dst);
      if (existing_candidate === undefined) {
        candidates_by_dst.set(item.dst, {
          dst: item.dst,
          name_dst: item.name_dst ?? null,
          retry_count: item.retry_count,
          status,
          count: 1,
          first_index: global_index,
        });
      } else {
        existing_candidate.count += 1;
      }
      src_candidates.set(item.src, candidates_by_dst);
      global_index += 1;
    }

    const candidate_map = new Map<
      string,
      Array<{
        dst: string;
        name_dst: ProjectItemPublicRecord["name_dst"];
        retry_count: number;
        status: ProjectItemPublicRecord["status"];
        count: number;
        first_index: number;
      }>
    >();
    for (const [src, candidates_by_dst] of src_candidates.entries()) {
      candidate_map.set(
        src,
        [...candidates_by_dst.values()].sort((left_candidate, right_candidate) => {
          if (left_candidate.count !== right_candidate.count) {
            return right_candidate.count - left_candidate.count;
          }
          return left_candidate.first_index - right_candidate.first_index;
        }),
      );
    }
    return candidate_map;
  }

  /**
   * 按完整 item 集合重建翻译进度 meta，保留数据库现有累计统计
   */
  private build_translation_extras_for_items(
    project_path: string,
    items: Record<string, ProjectItemPublicRecord>,
  ): Record<string, unknown> {
    const public_item_map = build_public_item_map(items);
    return build_translation_extras_from_items({
      task_snapshot: this.build_translation_task_snapshot_from_meta(project_path),
      items: build_item_view_map(public_item_map),
    });
  }

  /**
   * reset-all 慢准备阶段只解析当前 asset 内容和稳定身份，不读取或绑定当前 item id
   */
  private async reparse_all_asset_identity_items(
    project_path: string,
  ): Promise<TranslationResetParsedItemDraft[]> {
    const asset_records = this.get_asset_records(project_path);
    const format_service = this.create_format_service();
    const item_drafts: TranslationResetParsedItemDraft[] = [];
    for (const record of asset_records) {
      const content = this.database.read_asset_content(project_path, record.path);
      if (content === null) {
        continue;
      }
      const parsed_items = await format_service.parse_asset(record.path, content);
      for (const parsed_item of parsed_items) {
        const identity_item = Item.from_json({
          ...Item.from_json(parsed_item).to_json(),
          file_path: record.path,
        }).to_json();
        const identity_key = this.build_item_identity_key(identity_item);
        if (identity_key === null) {
          this.throw_translation_reset_identity_error("preview_item_identity_mismatch");
        }
        item_drafts.push({ identity_key, identity_item });
      }
    }
    return item_drafts;
  }

  /**
   * reset-all 提交阶段用最新 item 身份表回填 id，避免解析窗口内旧 id 映射覆盖并发提交
   */
  private bind_reset_all_items_to_current_ids(
    project_path: string,
    item_drafts: TranslationResetParsedItemDraft[],
  ): ProjectItemPublicRecord[] {
    const current_item_id_by_identity = this.build_current_item_id_by_identity(project_path);
    const seen_identity_keys = new Set<string>();
    const items: ProjectItemPublicRecord[] = [];
    for (const item_draft of item_drafts) {
      const item_id = current_item_id_by_identity.get(item_draft.identity_key);
      if (item_id === undefined || seen_identity_keys.has(item_draft.identity_key)) {
        this.throw_translation_reset_identity_error("preview_item_identity_mismatch");
      }
      seen_identity_keys.add(item_draft.identity_key);
      items.push(
        this.normalize_public_item({
          ...item_draft.identity_item,
          id: item_id,
        }),
      );
    }
    if (items.length !== current_item_id_by_identity.size) {
      this.throw_translation_reset_identity_error("translation_reset_all_item_count_mismatch", {
        current_count: current_item_id_by_identity.size,
        preview_count: items.length,
      });
    }
    return items;
  }

  /**
   * 当前 item 身份由 file_path + row 决定，reset-all 用它绑定重新解析结果
   */
  private build_current_item_id_by_identity(project_path: string): Map<string, number> {
    const item_id_by_identity = new Map<string, number>();
    for (const item of this.get_all_items(project_path)) {
      const item_id = this.read_number(item["id"], 0);
      const identity_key = this.build_item_identity_key(item);
      if (item_id <= 0 || identity_key === null || item_id_by_identity.has(identity_key)) {
        this.throw_translation_reset_identity_error("current_item_identity_invalid");
      }
      item_id_by_identity.set(identity_key, item_id);
    }
    return item_id_by_identity;
  }

  /**
   * 构造不依赖数组位置的 item 身份键，避免文件重排改变 item id
   */
  private build_item_identity_key(item: JsonRecord): string | null {
    const file_path = String(item["file_path"] ?? "").trim();
    const row = this.read_number(item["row"] ?? item["row_number"], NaN);
    if (file_path === "" || !Number.isInteger(row) || row < 0) {
      return null;
    }
    return `${file_path}\u0000${row}`;
  }

  /**
   * reset-all 身份错误统一转成请求校验失败，并保留诊断原因
   */
  private throw_translation_reset_identity_error(
    reason: string,
    diagnostic_context: Record<string, ApiJsonValue> = {},
  ): never {
    throw new AppErrors.RequestValidationError({
      diagnostic_context: {
        reason,
        ...diagnostic_context,
      },
    });
  }

  /**
   * analysis reset 的最终 progress 由当前 items、checkpoint 和既有 meta 派生
   */
  private build_analysis_reset_extras(project_path: string, mode: string): Record<string, unknown> {
    const status_summary =
      mode === "failed"
        ? this.build_failed_analysis_status_summary(project_path)
        : build_analysis_status_summary(
            Object.values(this.to_public_item_record(this.get_all_items(project_path))).flatMap(
              (item) => {
                const view_item = derive_project_item_view_record(item);
                return view_item === null ? [] : [view_item];
              },
            ),
          );
    const preserved_extras =
      mode === "failed"
        ? this.pick_preserved_analysis_extras(
            normalize_analysis_progress_snapshot(
              this.normalize_object(this.get_all_meta(project_path)["analysis_extras"]),
            ),
          )
        : {};
    return build_analysis_progress_snapshot({
      extras: preserved_extras,
      status_summary,
    });
  }

  /**
   * failed 模式只删除失败 checkpoint，已成功 checkpoint 继续计入 processed
   */
  private build_failed_analysis_status_summary(project_path: string): Record<string, unknown> {
    const checkpoints = this.get_analysis_checkpoints(project_path);
    let total_line = 0;
    let processed_line = 0;
    for (const item of this.get_all_items(project_path)) {
      const view_item = derive_project_item_view_record(item);
      if (
        view_item === null ||
        view_item.src.trim() === "" ||
        is_task_skipped_item_status(view_item.status)
      ) {
        continue;
      }
      total_line += 1;
      if (checkpoints.get(view_item.item_id) === "PROCESSED") {
        processed_line += 1;
      }
    }
    return {
      total_line,
      processed_line,
      error_line: 0,
      line: processed_line,
    };
  }

  /**
   * failed 分析重置保留累计耗时与 token，行级统计随后由当前 checkpoint 覆盖
   */
  private pick_preserved_analysis_extras(extras: Record<string, unknown>): Record<string, unknown> {
    return {
      start_time: extras.start_time ?? 0.0,
      time: extras.time ?? 0.0,
      total_tokens: extras.total_tokens ?? 0,
      total_input_tokens: extras.total_input_tokens ?? 0,
      total_output_tokens: extras.total_output_tokens ?? 0,
    };
  }

  /**
   * 读取分析 checkpoint 状态，过滤掉未知状态避免污染 reset 统计
   */
  private get_analysis_checkpoints(project_path: string): Map<number, string> {
    const value = this.database.execute(
      this.op("getAnalysisItemCheckpoints", { projectPath: project_path }),
    );
    const checkpoints = new Map<number, string>();
    if (!Array.isArray(value)) {
      return checkpoints;
    }
    for (const row of value) {
      if (!this.is_record(row)) {
        continue;
      }
      const item_id = this.read_number(row["item_id"], 0);
      const status = String(row["status"] ?? "");
      if (item_id > 0 && (status === "PROCESSED" || status === "ERROR")) {
        checkpoints.set(item_id, status);
      }
    }
    return checkpoints;
  }

  /**
   * 当前 loaded 工程是大多数 P2 mutation 的唯一目标
   */
  private async require_loaded_project_path(): Promise<string> {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }

  /**
   * settings alignment 允许显式 path 写未 loaded 项目，其余沿用 loaded 目标
   */
  private async resolve_project_path(request: JsonRecord): Promise<string> {
    const explicit_path = String(request["path"] ?? "").trim();
    if (explicit_path !== "") {
      this.assert_explicit_project_file_exists(explicit_path);
      return explicit_path;
    }
    return this.require_loaded_project_path();
  }

  /**
   * 显式 path 来自打开前设置对齐，必须先确认旧工程存在，避免 SQLite 静默创建空库
   */
  private assert_explicit_project_file_exists(project_path: string): void {
    if (!this.native_fs.exists(project_path)) {
      throw new AppErrors.ProjectNotFoundError({
        public_details: {
          filename: project_path.split(/[\\/]/u).at(-1) ?? "",
        },
      });
    }
  }

  /**
   * 只写项目设置镜像时使用的受限 meta 白名单
   */
  private build_project_settings_only_meta(value: ApiJsonValue | undefined): MutableJsonRecord {
    return normalize_project_settings_snapshot(value) as unknown as MutableJsonRecord;
  }

  /**
   * 归一术语规则条目，保持和质量规则入口一致的字段白名单
   */
  private normalize_rule_entries(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry): entry is JsonRecord => this.is_record(entry))
      .map((entry) => ({
        src: String(entry["src"] ?? "").trim(),
        dst: String(entry["dst"] ?? "").trim(),
        info: String(entry["info"] ?? "").trim(),
        regex: Boolean(entry["regex"] ?? false),
        case_sensitive: Boolean(entry["case_sensitive"] ?? false),
      }))
      .filter((entry) => entry["src"] !== "");
  }

  /**
   * 读取当前质量规则条目，供分析导入判断是否需要推进 quality revision
   */
  private get_rule_entries(project_path: string, rule_type: string): MutableJsonRecord[] {
    return this.normalize_rule_entries(
      this.database.execute(
        this.op("getRules", {
          projectPath: project_path,
          ruleType: rule_type,
        }),
      ),
    );
  }

  /**
   * 规则列表按顺序比较完整写入形状，只有真实变化才 bump 质量规则 revision
   */
  private are_rule_entries_equal(
    left_entries: MutableJsonRecord[],
    right_entries: MutableJsonRecord[],
  ): boolean {
    if (left_entries.length !== right_entries.length) {
      return false;
    }
    for (let index = 0; index < left_entries.length; index += 1) {
      const left_entry = left_entries[index];
      const right_entry = right_entries[index];
      if (left_entry === undefined || right_entry === undefined) {
        return false;
      }
      if (
        left_entry["src"] !== right_entry["src"] ||
        left_entry["dst"] !== right_entry["dst"] ||
        left_entry["info"] !== right_entry["info"] ||
        left_entry["regex"] !== right_entry["regex"] ||
        left_entry["case_sensitive"] !== right_entry["case_sensitive"]
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * 术语导入后的候选数只从数据库候选聚合派生，renderer 不参与提交派生统计
   */
  private count_remaining_analysis_candidates(
    project_path: string,
    consumed_candidate_srcs: string[],
  ): number {
    const consumed_src_set = new Set(consumed_candidate_srcs);
    const rows = this.get_analysis_candidate_aggregates(project_path).filter((row) => {
      return !consumed_src_set.has(String(row["src"] ?? "").trim());
    });
    let count = 0;
    for (const row of rows) {
      const src = String(row["src"] ?? "").trim();
      const dst = this.pick_vote_winner(this.normalize_vote_map(row["dst_votes"]));
      const info = this.pick_vote_winner(this.normalize_vote_map(row["info_votes"]));
      if (src !== "" && dst !== "" && info !== "" && info.toLowerCase() !== "other") {
        count += 1;
      }
    }
    return count;
  }

  /**
   * 读取分析候选聚合，供后端派生剩余候选数
   */
  private get_analysis_candidate_aggregates(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(
      this.op("getAnalysisCandidateAggregates", { projectPath: project_path }),
    );
    return Array.isArray(value)
      ? value.filter((row): row is JsonRecord => this.is_record(row)).map((row) => ({ ...row }))
      : [];
  }

  /**
   * 归一投票表，只保留正数票，避免坏候选聚合影响派生统计
   */
  private normalize_vote_map(value: ApiJsonValue | undefined): Record<string, number> {
    if (!this.is_record(value)) {
      return {};
    }
    const votes: Record<string, number> = {};
    for (const [text, raw_count] of Object.entries(value)) {
      const normalized_text = text.trim();
      const count = this.read_number(raw_count, 0);
      if (normalized_text !== "" && count > 0) {
        votes[normalized_text] = count;
      }
    }
    return votes;
  }

  /**
   * 候选导入预览按最高票选展示值，后端统计沿用同一最小口径
   */
  private pick_vote_winner(votes: Record<string, number>): string {
    let winner = "";
    let winner_votes = -1;
    for (const [text, count] of Object.entries(votes)) {
      if (count > winner_votes) {
        winner = text;
        winner_votes = count;
      }
    }
    return winner;
  }

  /**
   * 校验工作台路径必须存在，避免删除或重置不存在的 asset
   */
  private assert_rel_paths_exist(project_path: string, rel_paths: string[]): void {
    if (rel_paths.length === 0) {
      throw new AppErrors.RequestValidationError();
    }
    const existing = new Set(this.get_asset_records(project_path).map((record) => record.path));
    for (const rel_path of rel_paths) {
      if (!existing.has(rel_path)) {
        throw new AppErrors.FileNotFoundError({
          public_details: { rel_path },
        });
      }
    }
  }

  /**
   * 校验重排序 payload 完整覆盖当前 asset 集合
   */
  private assert_complete_path_order(current_paths: string[], ordered_paths: string[]): void {
    if (current_paths.length !== ordered_paths.length) {
      throw new AppErrors.RequestValidationError();
    }
    const current = new Set(current_paths);
    const ordered = new Set(ordered_paths);
    if (current.size !== ordered.size) {
      throw new AppErrors.RequestValidationError();
    }
    for (const rel_path of current) {
      if (!ordered.has(rel_path)) {
        throw new AppErrors.RequestValidationError();
      }
    }
  }

  /**
   * 读取全部 item dict，供局部 merge 和工作台 append 使用
   */
  private get_all_items(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(this.op("getAllItems", { projectPath: project_path }));
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * 读取 asset 顺序记录，隐藏数据库返回字段名差异
   */
  private get_asset_records(project_path: string): Array<{ path: string; sort_order: number }> {
    const value = this.database.execute(
      this.op("getAllAssetRecords", { projectPath: project_path }),
    );
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => this.is_record(item))
      .map((item) => ({
        path: String(item["path"] ?? ""),
        sort_order: this.read_number(item["sort_order"], 0),
      }));
  }

  /**
   * 读取完整 meta，用于 revision 判断
   */
  private get_all_meta(project_path: string): MutableJsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  /**
   * 把未知 JSON 收窄为对象，避免深层读取扩散类型断言
   */
  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 归一字符串数组，路径列表和 ordered id 都复用这一层
   */
  private normalize_string_list(value: ApiJsonValue | undefined): string[] {
    return Array.isArray(value)
      ? value.map((item) => String(item)).filter((item) => item !== "")
      : [];
  }

  /**
   * 从 JSON 值读取数字，避免 NaN 泄漏到数据库 payload
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? number_value : fallback;
  }

  /**
   * 收窄 JSON 对象，保护数组和 null 不被当作 record
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 创建 database workflow 操作，避免业务方法重复拼协议壳
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
