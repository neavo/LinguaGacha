import type { RPGMakerMvMzPrepareExecution } from "../file/rpgmaker-mv-mz/prepare-worker";
import type { SourceFileParseWarning } from "../file/file-format-types";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import { coordinate_project_duplicate_statuses } from "../../shared/project/project-item-duplicates";
import type { ProjectDatabaseAccess } from "../database/database-operations";
import type { ProjectPreviewResponse } from "../../shared/project-preview";
import type { PDFExecution } from "../file/pdf/pdf-worker";
import path from "node:path";

import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectDatabase } from "../database/database-operations";
import { FileFormatService } from "../file/file-format-service";
import {
  log_source_file_parse_failures,
  log_source_file_parse_warnings,
} from "../file/source-file-parse-failure-reporter";
import {
  SourceFileParsePipeline,
  type SourceFileProjectDraft,
} from "../file/source-file-parse-pipeline";
import type { LogManager } from "../log/log-manager";
import { build_project_open_writes } from "../migration/project-migrations";
import {
  build_project_item_persistent_records,
  collect_project_item_missing_public_fields,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "../../domain/item";
import {
  read_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";
import {
  normalize_project_settings_snapshot,
  normalize_setting_snapshot,
  type ProjectSettingsSnapshot,
} from "../../domain/setting";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import type { ProjectSourceFileSummary } from "../../shared/project-source-formats";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import type { ProjectWriteResult } from "../../shared/project-event";
import {
  compute_project_prefilter_write,
  build_translation_extras_from_items,
  type ProjectPrefilterWriteOutput,
} from "./project-write-state";
import {
  ProjectDataReader,
  type ProjectDataSnapshot,
  build_section_revisions_from_meta,
  get_section_revision,
} from "./project-data-reader";
import type { CacheManager } from "../cache/cache-manager";
import {
  ProjectDefaultPresetReader,
  type ProjectDefaultPresetInput,
} from "./project-default-preset-reader";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "./project-session-state";
import type { ProjectWriteStore } from "./project-write-store";
import {
  resolve_project_prompt_storage,
  resolve_project_quality_rule_storage,
  type ProjectTaskInput,
} from "./project-task-input";

const INITIAL_PRESET_REVISION = 1;

/**
 * 承载 项目轻生命周期公开接口，公开 loaded/path 与 .lg 写入边界都在这里收口
 */
export class ProjectLifecycleService {
  private readonly database: ProjectDatabase; // .lg 物理事实唯一写入口，项目域只拼受限 operation

  private readonly runtime_gate: RuntimeOperationGate; // 工程生命周期与模型运行共享同一互斥事实

  private readonly session_state: ProjectSessionState; // 渲染进程可见 loaded/path 的唯一权威

  private readonly app_setting_service: AppSettingService; // 提供当前应用设置，用于打开预演与默认预设选择

  private readonly log_manager: LogManager; // 记录生命周期解析失败和诊断，响应体不扩大公开协议

  private readonly cache: Pick<CacheManager, "installProject" | "clearProject">; // 安装已提交事实，失败会阻断 loaded。

  private readonly write_store: ProjectWriteStore; // loaded 工程任务输入统一交给运行期唯一写入口

  private readonly native_fs: NativeFs; // 项目域读取外部文件和校验 .lg 路径的唯一文件系统门面

  private readonly default_preset_reader: ProjectDefaultPresetReader; // 隔离默认预设文件读取和非阻断日志

  /**
   * 初始化项目生命周期依赖，保持公开路由层只负责装配
   */
  public constructor(
    database: ProjectDatabase,
    runtime_gate: RuntimeOperationGate,
    session_state: ProjectSessionState,
    app_setting_service: AppSettingService,
    paths: AppPathService,
    log_manager: LogManager,
    cache: Pick<CacheManager, "installProject" | "clearProject">,
    write_store: ProjectWriteStore,
    private readonly pdf_execution: PDFExecution,
    native_fs: NativeFs = default_native_fs,
    private readonly rpgmaker_mv_mz_prepare_execution?: RPGMakerMvMzPrepareExecution,
  ) {
    this.database = database;
    this.runtime_gate = runtime_gate;
    this.session_state = session_state;
    this.app_setting_service = app_setting_service;
    this.log_manager = log_manager;
    this.cache = cache;
    this.write_store = write_store;
    this.native_fs = native_fs;
    this.default_preset_reader = new ProjectDefaultPresetReader(
      app_setting_service,
      paths,
      log_manager,
      native_fs,
    );
  }

  /**
   * 读取当前工程快照。公开 loaded/path 只来自 会话权威
   */
  public async get_project_snapshot(): Promise<JsonRecord> {
    const state = this.session_state.snapshot();
    return {
      project: {
        path: state.projectPath,
        loaded: state.loaded,
      },
    };
  }

  /**
   * 加载既有 .lg，并在标记会话 loaded 前完成打开期 operation 迁移
   */
  public async load_project(body: JsonRecord): Promise<JsonRecord> {
    return await this.runtime_gate.run_project_write(
      async () => await this.load_project_under_lease(body),
    );
  }

  /**
   * 在生命周期租约内准备旧工程事实，事务成功后激活会话。
   */
  private async load_project_under_lease(body: JsonRecord): Promise<JsonRecord> {
    const project_path = this.require_body_string(body, "path");
    this.assert_project_file_exists(project_path);
    let committed = false; // 包含连接释放在内的提交后步骤都只能要求恢复。
    try {
      await this.database.prepare(project_path);
      // 打开期迁移只生成 operation，和 updated_at 一起提交后才暴露 loaded 状态
      const migration_writes = await build_project_open_writes({
        project_path,
        database: this.database,
        app_setting_service: this.app_setting_service,
      });

      const snapshot = await this.database.transaction(project_path, (writer) => {
        writer.set_meta(project_path, "updated_at", this.build_timestamp());
        for (const write of migration_writes) {
          write(writer);
        }
        return this.coordinate_open_project_duplicates(
          writer,
          project_path,
          new ProjectDataReader(writer).read_snapshot(project_path),
        );
      });
      committed = true;
      return await this.activate_project(project_path, snapshot);
    } catch (cause) {
      if (AppErrors.is_app_error(cause) && cause.code === "data.committed_sync_failed") throw cause;
      if (!committed) throw cause;
      throw new AppErrors.AppError("data.committed_sync_failed", {
        cause,
        public_details: { committed: true, action: "reload_project" },
        diagnostic_context: { operation: "load_project_after_commit" },
      });
    }
  }

  /** 格式迁移可能改写原文。在同一打开事务内协调最终条目，再让缓存和会话消费。 */
  private coordinate_open_project_duplicates(
    writer: ProjectDatabaseAccess,
    project_path: string,
    snapshot: ProjectDataSnapshot,
  ): ProjectDataSnapshot {
    const { meta, items } = snapshot;
    const settings = this.build_stored_project_settings(meta, {
      ...read_json_record(meta["prefilter_config"]),
    });
    const changes = coordinate_project_duplicate_statuses(
      items,
      settings.skip_duplicate_source_text_enable,
    );
    if (changes.length === 0) return snapshot;
    const statuses = new Map(changes.map(({ item_id, status }) => [item_id, status]));
    const next_items = items.map((item) => {
      const status = statuses.get(item.item_id);
      return status === undefined ? item : { ...item, status };
    });
    const writes = next_items
      .filter((item) => statuses.has(item.item_id))
      .map((item) => ({ item_id: item.item_id, next: item }));
    writer.patch_item_translation_fields(project_path, writes);
    const translation_extras = build_translation_extras_from_items({
      progress: normalize_batch_translation_progress(meta["translation_extras"]),
      items: next_items,
    }) as unknown as JsonValue;
    writer.set_meta(project_path, "translation_extras", translation_extras);
    return { ...snapshot, items: next_items, meta: { ...meta, translation_extras } };
  }

  /** 新建与加载共用提交后激活和恢复错误协议。 */
  private async activate_project(
    project_path: string,
    snapshot: ProjectDataSnapshot,
  ): Promise<JsonRecord> {
    try {
      this.cache.installProject(project_path, snapshot);
      await this.session_state.mark_loaded(project_path);
      return this.build_loaded_project_response(project_path);
    } catch (cause) {
      if (AppErrors.is_app_error(cause) && cause.code === "data.committed_sync_failed") throw cause;
      throw new AppErrors.AppError("data.committed_sync_failed", {
        cause,
        public_details: { committed: true, action: "reload_project" },
        diagnostic_context: { operation: "activate_project_after_commit" },
      });
    }
  }

  /**
   * 后端按用户源路径生成当前格式工程事实，提交后直接激活。
   */
  public async create_project_commit(body: JsonRecord): Promise<JsonRecord> {
    return await this.runtime_gate.run_project_write(
      async (signal) => await this.create_project_commit_under_lease(body, signal),
    );
  }

  /**
   * 新建工程的慢解析、数据库提交与 loaded 切换必须处于同一生命周期租约。
   */
  private async create_project_commit_under_lease(
    body: JsonRecord,
    signal: AbortSignal,
  ): Promise<JsonRecord> {
    const requested_project_path = this.require_body_string(body, "path");
    const project_path = this.resolve_create_project_path(requested_project_path);
    this.assert_no_legacy_create_commit_fields(body);
    const source_paths = this.normalize_source_paths(body["source_paths"]);
    const project_settings = this.read_create_project_settings(body["project_settings"]);
    // 后端重新解析源文件得到的唯一可信新建草稿。
    const parsed_draft = await new SourceFileParsePipeline(
      this.create_format_service(project_settings),
    ).build_project_draft(source_paths, signal);
    signal.throwIfAborted();
    this.assert_create_commit_has_importable_files(parsed_draft);
    // 将可信草稿转成持久项目事实的唯一计算结果。
    const prefilter_output = this.compute_create_project_prefilter_output({
      draft: parsed_draft,
      settings: project_settings,
    });
    const default_preset_input = this.default_preset_reader.read();
    let snapshot!: ProjectDataSnapshot; // 初始化事务同步产出，失败时数据库入口抛错并清理新文件。

    await this.database.create_project(
      project_path,
      this.build_project_name(source_paths, project_path),
      (writer) => {
        this.write_default_presets(writer, project_path, default_preset_input);
        for (const file of parsed_draft.files) {
          writer.add_asset(
            project_path,
            file.rel_path,
            file.content,
            file.file_type,
            file.pdf_document,
            file.sort_index,
          );
        }
        writer.set_items(
          project_path,
          build_project_item_persistent_records(prefilter_output.items) as unknown as JsonValue[],
        );
        writer.upsert_meta_entries(
          project_path,
          this.build_project_settings_meta({
            project_settings,
            prefilter_output,
          }) as unknown as JsonRecord,
        );
        writer.upsert_meta_entries(project_path, {
          translation_prompt_legacy_migrated: true,
          "migration.asset_file_type_complete": true,
        });
        snapshot = new ProjectDataReader(writer).read_snapshot(project_path);
      },
    );

    const response = await this.activate_project(project_path, snapshot);
    this.log_create_commit_parse_diagnostics(parsed_draft.failed_files, parsed_draft.warnings);
    this.default_preset_reader.log_loaded_names(default_preset_input.loaded_names);
    return parsed_draft.failed_files.length === 0
      ? response
      : { ...response, failed_files: parsed_draft.failed_files as unknown as JsonValue };
  }

  /**
   * 为当前 loaded 工程一次性应用领域任务输入，CLI 无需理解 Store 或物理 meta。
   */
  public async apply_task_input(input: ProjectTaskInput): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(async () => {
      const project_path = this.session_state.require_loaded_project_path();
      const section_revisions = build_section_revisions_from_meta(
        await this.database.get_all_meta(project_path),
      );
      return await this.write_store.apply_task_input({
        projectPath: project_path,
        expectedSectionRevisions: {
          quality: section_revisions.quality ?? 0,
          prompts: section_revisions.prompts ?? 0,
        },
        input,
      });
    });
  }

  /**
   * 默认预设显式输入在新建事务内落库，不把数据库写闭包泄漏给读取器。
   */
  private write_default_presets(
    writer: ProjectDatabaseAccess,
    project_path: string,
    input: ProjectDefaultPresetInput,
  ): void {
    writer.set_meta(project_path, "glossary_enable", true);
    writer.set_meta(project_path, "text_preserve_mode", input.text_preserve_mode);
    for (const rule of input.quality_rules) {
      const storage = resolve_project_quality_rule_storage(rule.kind);
      writer.set_rules(project_path, storage.database_type, rule.entries as unknown as JsonValue[]);
      if (storage.enabled_meta_key !== null && rule.enabled !== null) {
        writer.set_meta(project_path, storage.enabled_meta_key, rule.enabled);
      }
      if (storage.mode_meta_key !== null && rule.mode !== null) {
        writer.set_meta(project_path, storage.mode_meta_key, rule.mode);
      }
      writer.set_meta(project_path, storage.revision_meta_key, INITIAL_PRESET_REVISION);
    }
    if (input.translation_prompt !== null) {
      const prompt = input.translation_prompt;
      const storage = resolve_project_prompt_storage();
      writer.set_rule_text(project_path, storage.database_type, prompt.text);
      writer.set_meta(project_path, storage.enabled_meta_key, prompt.enabled);
      writer.set_meta(project_path, storage.revision_meta_key, INITIAL_PRESET_REVISION);
    }
  }

  /**
   * 新建工程提交不接受旧前端事实字段，避免恢复渲染进程写库能力
   */
  private assert_no_legacy_create_commit_fields(body: JsonRecord): void {
    for (const field of [
      "draft",
      "files",
      "items",
      "translation_extras",
      "prefilter_config",
      "parsed_items",
      "file_record",
    ]) {
      if (Object.hasOwn(body, field)) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "legacy_create_commit_field", field },
        });
      }
    }
  }

  /**
   * 读取 create-commit 设置镜像。缺字段时回到当前应用设置，保持空请求可创建空工程
   */
  private read_create_project_settings(value: JsonValue | undefined): ProjectSettingsSnapshot {
    const current = this.build_current_project_settings();
    return normalize_project_settings_snapshot(value, current);
  }

  /**
   * 只在存在候选源文件且全部解析失败时阻断。空工程创建仍保留原有测试和内部语义。
   */
  private assert_create_commit_has_importable_files(draft: SourceFileProjectDraft): void {
    if (draft.files.length > 0 || draft.failed_files.length === 0) {
      return;
    }
    this.log_create_commit_parse_diagnostics(draft.failed_files, draft.warnings);
    throw new AppErrors.AppError("file.parse_failed", {
      public_details: {
        failed_files: draft.failed_files as unknown as JsonValue,
      },
      diagnostic_context: { reason: "all_source_files_parse_failed" },
    });
  }

  /**
   * 新建工程诊断统一记录文件失败与未提取脚本的位置。
   */
  private log_create_commit_parse_diagnostics(
    failed_files: SourceFileParseFailureRecord[],
    warnings: SourceFileParseWarning[],
  ): void {
    log_source_file_parse_warnings({
      warnings,
      log_manager: this.log_manager,
      source: "project-lifecycle",
    });
    log_source_file_parse_failures({
      failures: failed_files,
      log_manager: this.log_manager,
      source: "project-lifecycle",
    });
  }

  /**
   * 新建预过滤直接消费解析草稿，在此校验并转换条目字段。
   */
  private compute_create_project_prefilter_output(args: {
    draft: SourceFileProjectDraft;
    settings: ProjectSettingsSnapshot;
  }): ProjectPrefilterWriteOutput {
    return compute_project_prefilter_write({
      state: {
        files: Object.fromEntries(args.draft.files.map((file) => [file.rel_path, file])),
        items: Object.fromEntries(
          args.draft.items.map((item) => {
            const record = this.normalize_public_item(item);
            return [String(record.item_id), record];
          }),
        ),
      },
      source_language: args.settings.source_language,
      mtool_optimizer_enable: args.settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: args.settings.skip_duplicate_source_text_enable,
    });
  }

  /**
   * 新建工程解析使用请求设置镜像，避免文件格式处理读取到过期应用语言
   */
  private create_format_service(project_settings: ProjectSettingsSnapshot): FileFormatService {
    const config = normalize_setting_snapshot(this.app_setting_service.read_setting());
    return new FileFormatService(
      {
        target_language: project_settings.target_language,
        deduplication_in_bilingual: config.deduplication_in_bilingual,
        write_translated_name_fields_to_file: config.write_translated_name_fields_to_file,
      },
      this.pdf_execution,
      this.native_fs,
      this.rpgmaker_mv_mz_prepare_execution,
    );
  }

  /**
   * 解析和持久化条目先通过公开 DTO 校验，再参与状态计算。
   */
  private normalize_public_item(value: unknown): ProjectItemPublicRecord {
    const public_item = normalize_project_item_public_record(value);
    if (public_item === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: {
          reason: "parsed_item_incomplete",
          missing_fields: collect_project_item_missing_public_fields(value),
        },
      });
    }
    return public_item;
  }

  /**
   * 读取打开工程前的设置对齐预演，不进入 loaded 状态，也不写运行态事实
   */
  public async get_open_alignment_preview(body: JsonRecord): Promise<JsonRecord> {
    const project_path = this.require_body_string(body, "path");
    this.assert_project_file_exists(project_path);
    await this.database.prepare(project_path);

    const meta = await this.database.get_all_meta(project_path);
    const prefilter_config = {
      ...read_json_record(meta["prefilter_config"] as JsonValue),
    };
    const current_settings = this.build_current_project_settings();
    const project_settings = this.build_stored_project_settings(meta, prefilter_config);
    const changed = {
      source_language: project_settings.source_language !== current_settings.source_language,
      target_language: project_settings.target_language !== current_settings.target_language,
      mtool_optimizer_enable:
        this.is_setting_mirror_missing(meta, prefilter_config, "mtool_optimizer_enable") ||
        project_settings.mtool_optimizer_enable !== current_settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable:
        this.is_setting_mirror_missing(
          meta,
          prefilter_config,
          "skip_duplicate_source_text_enable",
        ) ||
        project_settings.skip_duplicate_source_text_enable !==
          current_settings.skip_duplicate_source_text_enable,
    };
    const needs_prefiltered_items =
      changed.source_language ||
      changed.mtool_optimizer_enable ||
      changed.skip_duplicate_source_text_enable;
    const action = needs_prefiltered_items
      ? "prefiltered_items"
      : changed.target_language
        ? "settings_only"
        : "load";
    return {
      preview: {
        action,
        project_path,
        project_settings,
        current_settings,
        changed,
        section_revisions: needs_prefiltered_items
          ? this.build_project_alignment_section_revisions(meta)
          : null,
      },
    };
  }

  /**
   * 卸载公开工程会话，并释放 database 缓存句柄
   */
  public async unload_project(): Promise<JsonRecord> {
    return await this.runtime_gate.run_project_write(async () => {
      const state = this.session_state.snapshot();
      if (state.loaded && state.projectPath !== "") {
        this.cache.clearProject(state.projectPath);
        await this.session_state.clear();
        await this.database.close_project(state.projectPath);
      } else {
        await this.session_state.clear();
      }
      return {
        project: {
          path: "",
          loaded: false,
        },
      };
    });
  }

  /**
   * 读取 .lg 摘要预览，不加载工程会话
   */
  public async get_project_preview(body: JsonRecord): Promise<ProjectPreviewResponse> {
    const project_path = this.require_body_string(body, "path");
    this.assert_project_file_exists(project_path);
    await this.database.prepare(project_path);
    return { preview: await this.database.get_project_summary(project_path) };
  }

  /**
   * 汇总可导入源文件总数和互斥格式命中数，不向 renderer 暴露本地文件路径
   */
  public async summarize_source_files(body: JsonRecord): Promise<ProjectSourceFileSummary> {
    const source_paths = this.normalize_source_paths(body["source_paths"]);
    return this.create_format_service(this.build_current_project_settings()).summarize_source_files(
      source_paths,
    );
  }

  /**
   * 构建工程设置镜像 meta，预过滤与进度事实只取后端计算结果
   */
  private build_project_settings_meta(args: {
    project_settings: ProjectSettingsSnapshot;
    prefilter_output: ProjectPrefilterWriteOutput;
  }): MutableJsonRecord {
    return {
      source_language: args.project_settings.source_language,
      target_language: args.project_settings.target_language,
      mtool_optimizer_enable: args.project_settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: args.project_settings.skip_duplicate_source_text_enable,
      prefilter_config: args.prefilter_output.prefilter_config as unknown as JsonValue,
      translation_extras: args.prefilter_output.translation_extras as unknown as JsonValue,
    };
  }

  /**
   * 打开前 settings alignment 只声明后端事实依赖版本，项目数据实体仍由 loaded 后的读取接口提供
   */
  private build_project_alignment_section_revisions(meta: MutableJsonRecord): MutableJsonRecord {
    return {
      files: get_section_revision(meta, "files"),
      items: get_section_revision(meta, "items"),
    };
  }

  /**
   * 读取当前应用设置，作为打开前 settings alignment 的目标值
   */
  private build_current_project_settings(): ProjectSettingsSnapshot {
    return normalize_project_settings_snapshot(this.app_setting_service.read_setting());
  }

  /**
   * 读取项目内设置镜像，优先当前 meta，缺失时回退 prefilter_config
   */
  private build_stored_project_settings(
    meta: MutableJsonRecord,
    prefilter_config: MutableJsonRecord,
  ): ProjectSettingsSnapshot {
    return normalize_project_settings_snapshot(
      meta,
      normalize_project_settings_snapshot(prefilter_config),
    );
  }

  /**
   * 判断设置镜像是否缺失，缺字段时必须触发预过滤对齐
   */
  private is_setting_mirror_missing(
    meta: MutableJsonRecord,
    prefilter_config: MutableJsonRecord,
    key: string,
  ): boolean {
    return !(key in meta) && !(key in prefilter_config);
  }

  /**
   * 新建工程名优先使用第一个源路径名称，否则使用输出文件名
   */
  private build_project_name(source_paths: string[], project_path: string): string {
    const seed_path = source_paths[0] ?? project_path;
    return path.basename(seed_path);
  }

  /**
   * 新建工程默认路径若已存在，则追加时间戳生成旁路文件，避免覆盖已有 .lg。
   */
  private resolve_create_project_path(project_path: string): string {
    if (!this.native_fs.exists(project_path)) {
      return project_path;
    }
    const parsed_path = path.parse(project_path);
    const extension = parsed_path.ext === "" ? ".lg" : parsed_path.ext;
    const timestamp_suffix = this.build_file_timestamp_suffix();
    const timestamped_path = path.join(
      parsed_path.dir,
      `${parsed_path.name}_${timestamp_suffix}${extension}`,
    );
    if (!this.native_fs.exists(timestamped_path)) {
      return timestamped_path;
    }
    let sequence = 2;
    let sequence_path = this.build_project_sequence_path(
      parsed_path,
      timestamp_suffix,
      extension,
      sequence,
    );
    while (this.native_fs.exists(sequence_path)) {
      sequence += 1;
      sequence_path = this.build_project_sequence_path(
        parsed_path,
        timestamp_suffix,
        extension,
        sequence,
      );
    }
    return sequence_path;
  }

  /**
   * 项目文件撞名后缀使用和前端展示一致的本地时间格式。
   */
  private build_file_timestamp_suffix(): string {
    const now = new Date();
    const pad = (value: number): string => value.toString().padStart(2, "0");
    return `${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  /**
   * 同秒撞名时追加递增序号，保证自动路径不会覆盖已有工程。
   */
  private build_project_sequence_path(
    parsed_path: path.ParsedPath,
    timestamp_suffix: string,
    extension: string,
    sequence: number,
  ): string {
    return path.join(
      parsed_path.dir,
      `${parsed_path.name}_${timestamp_suffix}_${sequence.toString()}${extension}`,
    );
  }

  /**
   * 构建 loaded 响应，保持公开项目快照形状不扩大
   */
  private build_loaded_project_response(project_path: string): JsonRecord {
    return {
      project: {
        path: project_path,
        loaded: true,
      },
    };
  }

  /**
   * 归一 source_paths，保持用户选择顺序和去重语义一致
   */
  private normalize_source_paths(value: JsonValue | undefined): string[] {
    const normalized_paths: string[] = [];
    const seen_keys = new Set<string>();
    for (const raw_path of this.normalize_string_list(value)) {
      const path_key = this.build_path_identity_key(raw_path);
      if (seen_keys.has(path_key)) {
        continue;
      }
      seen_keys.add(path_key);
      normalized_paths.push(raw_path);
    }
    return normalized_paths;
  }

  /**
   * 归一字符串列表，路径类 API 只接受非空字符串
   */
  private normalize_string_list(value: JsonValue | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === "string")
      .filter((item) => item.trim() !== "");
  }

  /**
   * 构造跨平台路径身份 key，Windows 下按文件系统大小写不敏感处理
   */
  private build_path_identity_key(source_path: string): string {
    return this.native_fs.to_identity_path(source_path);
  }

  /**
   * 校验请求体字符串字段，避免空 path 触发 SQLite 静默建库
   */
  private require_body_string(body: JsonRecord, key: string): string {
    const value = body[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new AppErrors.AppError("request.validation_failed");
    }
    return value;
  }

  /**
   * 打开既有工程前必须先确认文件存在，缺失时映射为 project.not_found
   */
  private assert_project_file_exists(project_path: string): void {
    if (!this.native_fs.exists(project_path)) {
      throw new AppErrors.AppError("project.not_found", {
        public_details: { filename: path.basename(project_path) },
      });
    }
  }

  /**
   * 生成更新时间戳，复用 ISO 字符串让 服务层与 database 摘要可排序
   */
  private build_timestamp(): string {
    return new Date().toISOString();
  }
}
