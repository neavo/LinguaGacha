import type { ApiJsonValue } from "../api/api-types";
import type { AppSettingService } from "../app/app-setting-service";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import { FileFormatService } from "../file/file-format-service";
import {
  SourceFileParsePipeline,
  type SourceFileParseResult,
} from "../file/source-file-parse-pipeline";
import { log_source_file_parse_failures } from "../file/source-file-parse-failure-reporter";
import type { LogManager } from "../log/log-manager";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import { ProjectWriteStore, type ProjectAssetWrite } from "../project/project-write-store";
import type { ProjectOperationGate } from "../project/project-gate";
import { ProjectSessionState } from "../project/project-session";
import {
  Item,
  collect_project_item_missing_public_fields,
  normalize_project_item_persistent_record,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "../../domain/item";
import {
  normalize_project_settings_snapshot,
  normalize_setting_snapshot,
  type ProjectSettingsSnapshot,
} from "../../domain/setting";
import type { ProjectDataSection, ProjectWriteResult } from "../../shared/project-event";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import {
  build_analysis_progress_snapshot,
  build_analysis_status_summary,
  build_item_view_map,
  build_public_item_map,
  build_translation_extras_from_items,
  compute_project_prefilter_write,
  create_empty_translation_task_snapshot,
  derive_project_item_view_record,
  normalize_analysis_progress_snapshot,
  type ProjectPrefilterWriteOutput,
} from "../project/project-changes";
import { count_analysis_glossary_candidates } from "../../shared/analysis-candidate";
import { is_task_skipped_item_status } from "../../domain/task";
import * as AppErrors from "../../shared/error";
import { t_main_log } from "../log/log-text";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

type ProjectWriteSettings = ProjectSettingsSnapshot; // 同步写入只消费设置领域定义的项目镜像窄字段

type WorkbenchAssetRecord = { path: string; sort_order: number };

type WorkbenchFileSection = Record<
  string,
  { rel_path: string; file_type: string; sort_index: number }
>;

type WorkbenchWriteSnapshot = {
  asset_records: WorkbenchAssetRecord[];
  item_records: MutableJsonRecord[];
  public_items_by_id: Map<number, ProjectItemPublicRecord>;
  files: WorkbenchFileSection;
};

type WorkbenchImportConflictAction = "skip" | "replace";

type ImportWorkbenchFileCommand = {
  source_path: string; // 用户选中的真实文件路径，只允许慢准备阶段读取
  target_rel_path: string; // 写入 .lg asset 的相对路径，提交阶段重新做唯一性校验
};

type TranslationResetParsedItemDraft = {
  identity_key: string; // 只表达解析条目的稳定身份，不绑定当前 item id
  identity_item: JsonRecord; // 重解析后的公开字段底稿，提交阶段再补当前 id
};

/**
 * 承载项目同步写入，把 API Gateway 的业务写入收口到 ProjectDatabase 窄操作
 */
export class WorkbenchService {
  private readonly database: ProjectDatabase; // 所有 .lg 写入必须经由 ProjectDatabase workflow，避免项目域直接碰 SQL

  private readonly project_operation_gate: ProjectOperationGate; // 结构性写入与任务启动统一经由后端互斥门闩

  private readonly session_state: ProjectSessionState; // 当前公开工程路径由 API Gateway 会话状态提供，避免同步写入回读旧缓存

  private readonly write_store: ProjectWriteStore; // 工作台只提交结构性业务意图，事务和事件交给 ProjectWriteStore

  private readonly app_setting_service: AppSettingService | null; // 文件重解析需要当前应用级格式配置；测试可为空并使用稳定默认值

  private readonly native_fs: NativeFs; // 只用于显式项目路径存在性校验，.lg 写入仍归 ProjectDatabase

  private readonly log_manager: Pick<LogManager, "warning"> | null; // 记录批量文件解析失败明细，不影响事务边界

  /**
   * 注入 database、互斥门闩和会话状态，保持写库边界可测试
   */
  public constructor(
    database: ProjectDatabase,
    project_operation_gate: ProjectOperationGate,
    session_state: ProjectSessionState,
    write_store: ProjectWriteStore,
    app_setting_service: AppSettingService | null = null,
    native_fs: NativeFs = default_native_fs,
    log_manager: Pick<LogManager, "warning"> | null = null,
  ) {
    this.database = database;
    this.project_operation_gate = project_operation_gate;
    this.session_state = session_state;
    this.write_store = write_store;
    this.app_setting_service = app_setting_service;
    this.native_fs = native_fs;
    this.log_manager = log_manager;
  }

  /**
   * 导入工作台文件，并按同名策略同步新增或替换文件事实
   */
  public async import_workbench_files(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = await this.require_loaded_project_path();
    return this.project_operation_gate.run_exclusive_project_write(async () => {
      this.assert_no_legacy_fields(request, [
        "items",
        "translation_extras",
        "prefilter_config",
        "analysis_extras",
      ]);
      const conflict_action = this.normalize_import_conflict_action(request["conflict_action"]);
      const file_commands = this.normalize_import_file_commands(request["files"]);
      if (file_commands.length === 0) {
        throw new AppErrors.RequestValidationError();
      }
      const parse_result = await this.parse_import_file_commands(file_commands);
      this.assert_workbench_import_has_parseable_files(parse_result);

      const snapshot = this.read_workbench_write_snapshot(project_path);
      const existing_record_by_key = new Map(
        snapshot.asset_records.map((record) => [record.path.toLowerCase(), record]),
      );
      const incoming_paths = new Set<string>();
      const current_items = snapshot.public_items_by_id;
      const current_files = { ...snapshot.files };
      const next_items = new Map(current_items);
      const old_items = [...current_items.values()];
      const imported_item_ids: number[] = [];
      const imported_files: Array<{
        mode: "add" | "replace";
        source_path: string;
        target_rel_path: string;
        file_record: { rel_path: string; file_type: string; sort_index: number };
      }> = [];
      let next_item_id = this.next_item_id_seed(current_items);
      let next_sort_order =
        snapshot.asset_records.reduce((max_sort_order, record) => {
          return Math.max(max_sort_order, record.sort_order);
        }, -1) + 1;
      for (const file of parse_result.file_drafts) {
        const target_key = file.rel_path.toLowerCase();
        if (incoming_paths.has(target_key)) {
          throw new AppErrors.RequestValidationError({
            diagnostic_context: {
              reason: "duplicate_import_target",
              rel_path: file.rel_path,
            },
          });
        }
        incoming_paths.add(target_key);
        const existing_record = existing_record_by_key.get(target_key);
        if (existing_record !== undefined && conflict_action === "skip") {
          continue;
        }
        const target_rel_path = existing_record?.path ?? file.rel_path;
        if (existing_record !== undefined) {
          for (const [item_id, item] of next_items.entries()) {
            if (item.file_path === target_rel_path) {
              next_items.delete(item_id);
            }
          }
        }
        const file_record = {
          rel_path: target_rel_path,
          file_type: file.file_type,
          sort_index: existing_record?.sort_order ?? next_sort_order,
        };
        if (existing_record === undefined) {
          next_sort_order += 1;
        }
        current_files[file_record.rel_path] = file_record;
        for (const parsed_item of file.parsed_items) {
          next_item_id += 1;
          const public_item = this.normalize_public_item({
            ...Item.from_json(parsed_item).to_json(),
            id: next_item_id,
            file_path: target_rel_path,
          });
          next_items.set(public_item.item_id, public_item);
          imported_item_ids.push(public_item.item_id);
        }
        imported_files.push({
          mode: existing_record === undefined ? "add" : "replace",
          source_path: file.source_path,
          target_rel_path,
          file_record,
        });
      }
      if (imported_files.length === 0) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "no_importable_files" },
        });
      }

      const settings = this.read_project_write_settings(project_path, request["project_settings"]);
      let write_output = this.compute_prefilter_output({
        project_path,
        files: current_files,
        items: this.public_item_record_from_map(next_items),
        settings,
      });
      if (String(request["inheritance_mode"] ?? "none") === "inherit") {
        const inherited_items = this.clone_public_item_record(write_output.items);
        this.inherit_completed_translations({
          old_items,
          next_items: imported_item_ids.flatMap((item_id) => {
            const item = inherited_items[String(item_id)];
            return item === undefined ? [] : [item];
          }),
        });
        write_output = this.compute_prefilter_output({
          project_path,
          files: current_files,
          items: inherited_items,
          settings,
        });
      }

      const asset_writes: ProjectAssetWrite[] = imported_files.map((file) =>
        file.mode === "add"
          ? {
              kind: "add_from_source",
              path: file.target_rel_path,
              sourcePath: file.source_path,
              sortOrder: file.file_record.sort_index,
            }
          : {
              kind: "update_from_source",
              path: file.target_rel_path,
              sourcePath: file.source_path,
            },
      );
      const write_result = await this.write_store.replace_workbench_items_and_files({
        projectPath: project_path,
        expectedSectionRevisions: request["expected_section_revisions"],
        revisionSections: ["files", "items", "analysis"],
        source: "workbench_import_files",
        updatedSections: ["files", "items", "analysis"],
        assetWrites: asset_writes,
        items: this.persistent_items_from_public_record(write_output.items),
        meta: this.build_prefilter_reset_meta(settings, write_output),
        resetAnalysis: true,
      });
      this.log_workbench_import_parse_failures(parse_result.failed_files);
      return this.with_parse_failures(write_result, parse_result.failed_files);
    });
  }

  /**
   * 重置指定工作台文件的条目事实，并清空分析状态
   */
  public async reset_workbench_file(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = await this.require_loaded_project_path();
    return this.project_operation_gate.run_exclusive_project_write(async () => {
      this.assert_no_legacy_fields(request, [
        "items",
        "translation_extras",
        "prefilter_config",
        "analysis_extras",
      ]);
      const rel_paths = this.normalize_string_list(request["rel_paths"]);
      if (rel_paths.length === 0) {
        throw new AppErrors.RequestValidationError();
      }
      const snapshot = this.read_workbench_write_snapshot(project_path);
      this.assert_rel_paths_exist(snapshot.asset_records, rel_paths);
      const rel_path_set = new Set(rel_paths);
      const items = this.public_item_record_from_map(snapshot.public_items_by_id);
      for (const item of Object.values(items)) {
        if (!rel_path_set.has(item.file_path)) {
          continue;
        }
        item.dst = "";
        item.name_dst = null;
        item.status = "NONE";
        item.retry_count = 0;
      }
      const settings = this.read_project_write_settings(project_path, request["project_settings"]);
      const write_output = this.compute_prefilter_output({
        project_path,
        files: snapshot.files,
        items,
        settings,
      });
      return await this.write_store.replace_workbench_items_and_files({
        projectPath: project_path,
        expectedSectionRevisions: request["expected_section_revisions"],
        revisionSections: ["items", "analysis"],
        source: "workbench_reset_file",
        updatedSections: ["items", "analysis"],
        items: this.persistent_items_from_public_record(write_output.items),
        meta: this.build_prefilter_reset_meta(settings, write_output),
        resetAnalysis: true,
      });
    });
  }

  /**
   * 删除工作台文件与对应条目，并清空分析状态
   */
  public async delete_workbench_file(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = await this.require_loaded_project_path();
    return this.project_operation_gate.run_exclusive_project_write(async () => {
      this.assert_no_legacy_fields(request, [
        "items",
        "translation_extras",
        "prefilter_config",
        "analysis_extras",
      ]);
      const rel_paths = this.normalize_string_list(request["rel_paths"]);
      if (rel_paths.length === 0) {
        throw new AppErrors.RequestValidationError();
      }
      const snapshot = this.read_workbench_write_snapshot(project_path);
      this.assert_rel_paths_exist(snapshot.asset_records, rel_paths);
      const rel_path_set = new Set(rel_paths);
      const files = { ...snapshot.files };
      for (const rel_path of rel_paths) {
        delete files[rel_path];
      }
      const items = this.public_item_record_from_map(snapshot.public_items_by_id);
      for (const item_id of Object.keys(items)) {
        const item = items[item_id];
        if (item !== undefined && rel_path_set.has(item.file_path)) {
          delete items[item_id];
        }
      }
      const settings = this.read_project_write_settings(project_path, request["project_settings"]);
      const write_output = this.compute_prefilter_output({
        project_path,
        files,
        items,
        settings,
      });
      return await this.write_store.replace_workbench_items_and_files({
        projectPath: project_path,
        expectedSectionRevisions: request["expected_section_revisions"],
        revisionSections: ["files", "items", "analysis"],
        source: "workbench_delete_file",
        updatedSections: ["files", "items", "analysis"],
        assetWrites: rel_paths.map((rel_path) => ({ kind: "delete", path: rel_path })),
        items: this.persistent_items_from_public_record(write_output.items),
        meta: this.build_prefilter_reset_meta(settings, write_output),
        resetAnalysis: true,
      });
    });
  }

  /**
   * 持久化完整文件顺序，确保拖拽重排只影响 files section
   */
  public async reorder_workbench_files(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = await this.require_loaded_project_path();
    return this.project_operation_gate.run_exclusive_project_write(async () => {
      const ordered_paths = this.normalize_string_list(request["ordered_rel_paths"]);
      const current_paths = this.get_asset_records(project_path).map((record) => record.path);
      this.assert_complete_path_order(current_paths, ordered_paths);
      return await this.write_store.reorder_workbench_files({
        projectPath: project_path,
        expectedSectionRevisions: request["expected_section_revisions"],
        orderedPaths: ordered_paths,
      });
    });
  }

  /**
   * 写入项目设置镜像；prefiltered_items 模式同时替换条目与分析计算状态
   */
  public async apply_settings_alignment(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = await this.resolve_project_path(request);
    const mode = String(request["mode"] ?? "").toLowerCase();
    const settings_meta = this.build_project_settings_only_meta(request["project_settings"]);
    if (mode === "settings_only") {
      return await this.write_store.apply_project_settings_meta({
        projectPath: project_path,
        meta: settings_meta,
      });
    }
    if (mode !== "prefiltered_items") {
      throw new AppErrors.RequestValidationError();
    }
    return this.project_operation_gate.run_exclusive_project_write(async () => {
      this.assert_no_legacy_fields(request, ["items", "translation_extras", "prefilter_config"]);
      const settings = this.read_project_write_settings(project_path, request["project_settings"]);
      const snapshot = this.read_workbench_write_snapshot(project_path);
      const write_output = this.compute_prefilter_output({
        project_path,
        files: snapshot.files,
        items: this.public_item_record_from_map(snapshot.public_items_by_id),
        settings,
      });
      return await this.write_store.replace_workbench_items_and_files({
        projectPath: project_path,
        expectedSectionRevisions: request["expected_section_revisions"],
        revisionSections: ["items", "analysis"],
        source: "settings_alignment",
        updatedSections: ["items", "analysis"],
        items: this.persistent_items_from_public_record(write_output.items),
        meta: {
          ...settings_meta,
          ...this.build_prefilter_reset_meta(settings, write_output),
        },
        resetAnalysis: true,
      });
    });
  }

  /**
   * 提交翻译重置结果，保持 all 与 failed 两种旧语义分离
   */
  public async apply_translation_reset(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = await this.require_loaded_project_path();
    const mode = String(request["mode"] ?? "").toLowerCase();
    this.assert_no_legacy_fields(request, ["items", "translation_extras", "prefilter_config"]);
    return this.project_operation_gate.run_exclusive_project_write(async () => {
      if (mode === "all") {
        const reset_item_drafts = await this.reparse_all_asset_identity_items(project_path);
        const settings = this.read_project_write_settings(
          project_path,
          request["project_settings"],
        );
        const snapshot = this.read_workbench_write_snapshot(project_path);
        const reset_items = this.bind_reset_all_items_to_current_ids(
          snapshot.item_records,
          reset_item_drafts,
        );
        const files = this.build_file_section_from_item_records(
          snapshot.asset_records,
          reset_items,
        );
        const write_output = this.compute_prefilter_output({
          project_path,
          files,
          items: this.public_item_record_from_array(reset_items),
          settings,
          task_snapshot: create_empty_translation_task_snapshot(),
        });
        return await this.write_store.replace_workbench_items_and_files({
          projectPath: project_path,
          expectedSectionRevisions: request["expected_section_revisions"],
          revisionSections: ["items", "analysis"],
          source: "translation_reset",
          updatedSections: ["items", "analysis"],
          items: this.persistent_items_from_public_record(write_output.items),
          meta: this.build_prefilter_reset_meta(settings, write_output),
          resetAnalysis: true,
        });
      }
      if (mode === "failed") {
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
        return await this.write_store.reset_translation_state({
          projectPath: project_path,
          expectedSectionRevisions: request["expected_section_revisions"],
          items: this.persistent_items_from_public_record(items),
          translationExtras: translation_extras as MutableJsonRecord,
        });
      }
      throw new AppErrors.RequestValidationError();
    });
  }

  /**
   * 提交分析重置结果，all 清空全部分析事实，failed 只清失败 checkpoint
   */
  public async apply_analysis_reset(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = await this.require_loaded_project_path();
    const mode = String(request["mode"] ?? "").toLowerCase();
    this.assert_no_legacy_fields(request, ["analysis_extras"]);
    return this.project_operation_gate.run_exclusive_project_write(async () => {
      const analysis_extras = this.build_analysis_reset_extras(project_path, mode);
      if (mode !== "all" && mode !== "failed") {
        throw new AppErrors.RequestValidationError();
      }
      return await this.write_store.reset_analysis_state({
        projectPath: project_path,
        expectedSectionRevisions: request["expected_section_revisions"],
        requireExpectedSectionRevisions: true,
        source: "analysis_reset",
        mode,
        analysisExtras: analysis_extras as MutableJsonRecord,
        ...(mode === "all" ? { analysisCandidateCount: 0 } : {}),
      });
    });
  }

  /**
   * 写入术语导入结果，同时对齐 quality 与 analysis revision
   */
  public async import_analysis_glossary(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = await this.require_loaded_project_path();
    this.assert_no_legacy_fields(request, [
      "analysis_candidate_count",
      "expected_glossary_revision",
    ]);
    const next_rules = this.normalize_rule_entries(request["entries"]);
    const quality_changed = !this.are_rule_entries_equal(
      this.get_rule_entries(project_path, "glossary"),
      next_rules,
    );
    const updated_sections: ProjectDataSection[] = quality_changed
      ? ["quality", "analysis"]
      : ["analysis"];
    const consumed_candidate_srcs = this.normalize_string_list(request["consumed_candidate_srcs"]);
    // 候选数是后端 meta 计算事实，只能根据数据库当前聚合和本次消费列表计算
    const analysis_candidate_count = this.count_remaining_analysis_candidates(
      project_path,
      consumed_candidate_srcs,
    );
    return await this.write_store.import_analysis_glossary({
      projectPath: project_path,
      expectedSectionRevisions: request["expected_section_revisions"],
      qualityRule: quality_changed
        ? {
            databaseType: "glossary",
            entries: next_rules,
            revisionKey: "quality_rule_revision.glossary",
          }
        : null,
      consumedCandidateSrcs: consumed_candidate_srcs,
      analysisCandidateCount: analysis_candidate_count,
      updatedSections: updated_sections,
    });
  }

  /**
   * 文件导入同名策略必须由页面确认后显式提交，避免后端猜测用户意图
   */
  private normalize_import_conflict_action(
    value: ApiJsonValue | undefined,
  ): WorkbenchImportConflictAction {
    if (value === "skip" || value === "replace") {
      return value;
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_import_conflict_action" },
    });
  }

  /**
   * 工作台导入文件 command 只承载用户意图；解析、id、预过滤和继承都在后端侧完成
   */
  private normalize_import_file_commands(
    value: ApiJsonValue | undefined,
  ): ImportWorkbenchFileCommand[] {
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
  private async parse_import_file_commands(
    file_commands: ImportWorkbenchFileCommand[],
  ): Promise<SourceFileParseResult> {
    return new SourceFileParsePipeline(
      this.create_format_service(),
      this.native_fs,
    ).parse_import_commands(
      file_commands.map((file) => ({
        source_path: file.source_path,
        rel_path: file.target_rel_path,
      })),
    );
  }

  /**
   * 所有提交文件都解析失败时阻断写入，避免创建一次无实际文件变化的项目事件。
   */
  private assert_workbench_import_has_parseable_files(result: SourceFileParseResult): void {
    if (result.file_drafts.length > 0 || result.failed_files.length === 0) {
      return;
    }
    this.log_workbench_import_parse_failures(result.failed_files);
    throw new AppErrors.FileParseFailedError({
      public_details: { failed_files: result.failed_files as unknown as ApiJsonValue },
      diagnostic_context: { reason: "all_workbench_import_files_parse_failed" },
    });
  }

  /**
   * 项目写入成功时只在确实跳过文件后附带失败明细，保持普通写入 payload 简洁。
   */
  private with_parse_failures(
    result: ProjectWriteResult,
    failed_files: SourceFileParseFailureRecord[],
  ): ProjectWriteResult {
    if (failed_files.length === 0) {
      return result;
    }
    return {
      ...result,
      failed_files,
    };
  }

  /**
   * 工作台导入解析失败写入日志，日志内容与页面 Toast 使用同一格式。
   */
  private log_workbench_import_parse_failures(failed_files: SourceFileParseFailureRecord[]): void {
    log_source_file_parse_failures({
      failures: failed_files,
      log_manager: this.log_manager,
      source: "workbench-import",
      text: t_main_log,
    });
  }

  /**
   * 旧 payload 字段出现时直接拒绝，避免渲染进程事实生成路径继续悄悄可用
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
   * 写入计算优先读取请求中的用户设置；缺失时回到项目 meta 镜像
   */
  private read_project_write_settings(
    project_path: string,
    value: ApiJsonValue | undefined,
  ): ProjectWriteSettings {
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
   * 结构性写入先集中读取一次 asset 与 item，后续只做内存派生
   */
  private read_workbench_write_snapshot(project_path: string): WorkbenchWriteSnapshot {
    const asset_records = this.get_asset_records(project_path);
    const item_records = this.get_all_items(project_path);
    const public_items_by_id = this.to_public_items_by_id(item_records);
    return {
      asset_records,
      item_records,
      public_items_by_id,
      files: this.build_file_section_from_item_records(asset_records, item_records),
    };
  }

  /**
   * 从调用方给定的 asset 与 item 快照构建预过滤输入中的 files section
   */
  private build_file_section_from_item_records(
    asset_records: WorkbenchAssetRecord[],
    item_records: Array<MutableJsonRecord | ProjectItemPublicRecord>,
  ): WorkbenchFileSection {
    const file_type_by_path = new Map<string, string>();
    for (const item of item_records) {
      const rel_path = String(item["file_path"] ?? "");
      if (rel_path !== "" && !file_type_by_path.has(rel_path)) {
        file_type_by_path.set(rel_path, String(item["file_type"] ?? "NONE"));
      }
    }
    const files: WorkbenchFileSection = {};
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
   * 预过滤输出由后端基于当前数据库事实计算，渲染进程不再提交最终 items 或 meta
   */
  private compute_prefilter_output(args: {
    project_path: string;
    files: Record<string, unknown>;
    items: Record<string, ProjectItemPublicRecord>;
    settings: ProjectWriteSettings;
    task_snapshot?: Record<string, unknown>;
  }): ProjectPrefilterWriteOutput {
    return compute_project_prefilter_write({
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
   * 预过滤类写入固定重置分析计算事实，并写入当前项目设置镜像
   */
  private build_prefilter_reset_meta(
    settings: ProjectWriteSettings,
    output: ProjectPrefilterWriteOutput,
  ): MutableJsonRecord {
    return {
      source_language: settings.source_language,
      target_language: settings.target_language,
      mtool_optimizer_enable: settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: settings.skip_duplicate_source_text_enable,
      prefilter_config: output.prefilter_config as unknown as ApiJsonValue,
      translation_extras: output.translation_extras as unknown as ApiJsonValue,
      analysis_extras: build_analysis_progress_snapshot({
        extras: output.analysis.extras,
        status_summary: output.analysis.status_summary,
      }) as unknown as ApiJsonValue,
      analysis_candidate_count: output.analysis.candidate_count,
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
    current_item_records: MutableJsonRecord[],
    item_drafts: TranslationResetParsedItemDraft[],
  ): ProjectItemPublicRecord[] {
    const current_item_id_by_identity =
      this.build_current_item_id_by_identity(current_item_records);
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
  private build_current_item_id_by_identity(items: MutableJsonRecord[]): Map<string, number> {
    const item_id_by_identity = new Map<string, number>();
    for (const item of items) {
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
   * 分析重置的最终 progress 由当前 items、checkpoint 和既有 meta 计算
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
   * 当前 loaded 工程是大多数 P2 写入的唯一目标
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
   * 术语导入后的候选数只从数据库候选聚合和共享可导出规则计算，渲染进程不参与提交统计
   */
  private count_remaining_analysis_candidates(
    project_path: string,
    consumed_candidate_srcs: string[],
  ): number {
    const consumed_src_set = new Set(consumed_candidate_srcs);
    const rows = this.get_analysis_candidate_aggregates(project_path).filter((row) => {
      return !consumed_src_set.has(String(row["src"] ?? "").trim());
    });
    return count_analysis_glossary_candidates(rows);
  }

  /**
   * 读取分析候选聚合，供后端计算剩余候选数
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
   * 校验工作台路径必须存在，避免删除或重置不存在的 asset
   */
  private assert_rel_paths_exist(asset_records: WorkbenchAssetRecord[], rel_paths: string[]): void {
    if (rel_paths.length === 0) {
      throw new AppErrors.RequestValidationError();
    }
    const existing = new Set(asset_records.map((record) => record.path));
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
  private get_asset_records(project_path: string): WorkbenchAssetRecord[] {
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
