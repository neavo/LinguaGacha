import { resolve_app_locale } from "../../domain/app-language";
import { project_knowledge_template, record_source_paths } from "./project-knowledge";
import { GameDirectoryOperations } from "../file/shared/game/game-directory-operations";
import { read_godot_pack_orders } from "../file/godot/source";
import type { GamePrepareExecution } from "../file/shared/game/prepare-worker";
import { coordinate_project_duplicate_statuses } from "../../shared/project/project-item-duplicates";
import type { ProjectDatabaseAccess } from "../database/database-operations";
import type { ProjectPreviewResponse } from "../../shared/project-preview";
import path from "node:path";

import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectDatabase } from "../database/database-operations";
import { FileFormatService } from "../file/file-format-service";
import {
  log_source_file_diagnostics,
  source_operation_error,
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
import type { JsonRecord, JsonValue } from "../../domain/json";
import {
  DEFAULT_PROJECT_LANGUAGE_SETTINGS,
  DEFAULT_PROJECT_SETTINGS,
  parse_project_language_patch,
  type ProjectLanguageSettings,
  type ProjectSettings,
} from "../../domain/project-settings";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import type { ProjectSourceFileSummary } from "../../shared/project-source-formats";
import {
  compute_project_prefilter_items,
  build_translation_extras_from_items,
} from "./project-write-state";
import { ProjectDataReader, type ProjectDataSnapshot } from "./project-data-reader";
import {
  ProjectDefaultPresetReader,
  type ProjectDefaultPresetInput,
} from "./project-default-preset-reader";
import {
  resolve_project_prompt_storage,
  resolve_project_quality_rule_storage,
} from "./project-task-input";

const INITIAL_PRESET_REVISION = 1;

/**
 * 承载 项目轻生命周期公开接口，公开 loaded/path 与 .lg 写入边界都在这里收口
 */
export class ProjectLifecycleService {
  private readonly default_preset_reader: ProjectDefaultPresetReader;

  public constructor(
    private readonly game_directory_operations: GameDirectoryOperations,
    private readonly database: ProjectDatabase,
    private readonly app_setting_service: AppSettingService,
    paths: AppPathService,
    private readonly log_manager: LogManager,
    private readonly native_fs: NativeFs = default_native_fs,
    private readonly game_prepare_execution?: GamePrepareExecution,
  ) {
    this.default_preset_reader = new ProjectDefaultPresetReader(
      app_setting_service,
      paths,
      log_manager,
      native_fs,
    );
  }

  /** 迁移和重复条目协调完成后返回可安装的工程事实。 */
  public async load_project(
    project_path: string,
    confirmed_target_app_version: unknown,
  ): Promise<ProjectDataSnapshot> {
    await this.database.prepare(project_path, confirmed_target_app_version);
    // 打开期迁移只生成 operation，和 updated_at 一起提交后才暴露 loaded 状态
    const migration_writes = await build_project_open_writes({
      project_path,
      database: this.database,
    });

    return this.database.transaction(project_path, (writer) => {
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
  }

  /** 格式迁移可能改写原文。在同一打开事务内协调最终条目，再让缓存和会话消费。 */
  private coordinate_open_project_duplicates(
    writer: ProjectDatabaseAccess,
    project_path: string,
    snapshot: ProjectDataSnapshot,
  ): ProjectDataSnapshot {
    const { meta, items } = snapshot;
    const changes = coordinate_project_duplicate_statuses(
      items,
      snapshot.settings.skip_duplicate_source_text_enable,
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
      progress: meta["translation_extras"],
      items: next_items,
    });
    writer.set_meta(project_path, "translation_extras", translation_extras);
    return { ...snapshot, items: next_items, meta: { ...meta, translation_extras } };
  }

  /** 先建立文件，再由组合根装配打开周期。 */
  public async create_project_commit(
    body: JsonRecord,
    signal: AbortSignal,
    on_game_sources_detected?: () => void,
  ) {
    const requested_project_path = this.require_body_string(body, "path");
    const project_path = this.resolve_create_project_path(requested_project_path);
    this.assert_no_legacy_create_commit_fields(body);
    const source_paths = this.normalize_source_paths(body["source_paths"]);
    const project_settings = this.read_create_project_settings(body["languages"]);
    // 后端重新解析源文件得到的唯一可信新建草稿。
    const format_service = this.create_format_service(project_settings);
    const parsed_draft = await format_service.with_source_directories(
      source_paths,
      async (signal) => {
        const entries = format_service.assign_source_file_paths(
          await format_service.collect_source_file_entries(
            source_paths,
            signal,
            read_godot_pack_orders(body["godot_pack_orders"]),
          ),
        );
        // CLI 备份提示必须先于本批全部准备操作，通知失败时也不能开始改写来源。
        if (entries.some((entry) => entry.source.kind === "game")) on_game_sources_detected?.();
        return new SourceFileParsePipeline(format_service).build_project_draft(entries, signal);
      },
      signal,
    );
    this.log_create_commit_parse_diagnostics(parsed_draft);
    let saved_assets = 0;
    try {
      signal.throwIfAborted();
      this.assert_create_commit_has_importable_files(parsed_draft);
      // 将可信草稿转成持久项目事实的唯一计算结果。
      const items = this.prefilter_create_project_items(parsed_draft, project_settings);
      const default_preset_input = this.default_preset_reader.read();
      let snapshot!: ProjectDataSnapshot; // 初始化事务同步产出，失败时数据库入口抛错并清理新文件。

      await this.database.create_project(project_path, (writer) => {
        this.write_default_presets(writer, project_path, default_preset_input);
        // 知识随工程建立，标题固定为此时的界面语言，没有可记录的路径时只写模板。
        const locale = resolve_app_locale(this.app_setting_service.read_app_language());
        writer.set_knowledge(
          project_path,
          record_source_paths(null, { paths: source_paths, locale }) ??
            project_knowledge_template(locale),
        );
        writer.bump_section_revisions(project_path, ["knowledge"]);
        for (const file of parsed_draft.files) {
          writer.add_asset(
            project_path,
            file.rel_path,
            file.content,
            file.file_type,
            file.sort_index,
          );
        }
        writer.set_items(
          project_path,
          build_project_item_persistent_records(items) as unknown as JsonValue[],
        );
        writer.upsert_meta_entries(project_path, {
          ...project_settings,
          translation_extras: build_translation_extras_from_items({ items: Object.values(items) }),
          "migration.asset_file_type_complete": true,
        });
        // 预过滤条目已分配身份并通过校验，写库只转换持久字段，提交后缓存可复用同一事实。
        snapshot = new ProjectDataReader(writer).read_snapshot(
          project_path,
          Object.values(items).sort((left, right) => left.item_id - right.item_id),
        );
      });

      saved_assets = parsed_draft.files.length; // 激活失败仍由外层回执保留已经提交的资产数量。
      this.default_preset_reader.log_loaded_names(default_preset_input.loaded_names);
      return {
        path: project_path,
        snapshot,
        source_operation: {
          saved_assets: parsed_draft.files.length,
          directory_changes: parsed_draft.directory_changes,
        },
      };
    } catch (error) {
      if (signal.aborted) throw error;
      throw source_operation_error(error, parsed_draft.directory_changes, saved_assets);
    }
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
      "project_settings",
    ]) {
      if (Object.hasOwn(body, field)) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "legacy_create_commit_field", field },
        });
      }
    }
  }

  /**
   * 新建工程允许指定初始语言，预过滤开关使用工程默认值。
   */
  private read_create_project_settings(value: JsonValue | undefined): ProjectSettings {
    return {
      ...DEFAULT_PROJECT_SETTINGS,
      ...parse_project_language_patch(value ?? {}),
    };
  }

  /**
   * 候选来源均未取得可靠原稿时阻断。没有候选来源的显式空工程仍允许创建。
   */
  private assert_create_commit_has_importable_files(draft: SourceFileProjectDraft): void {
    if (draft.files.length > 0 || draft.failures.length === 0) {
      return;
    }
    throw new AppErrors.AppError("file.parse_failed", {
      diagnostic_context: { reason: "all_source_files_parse_failed" },
    });
  }

  /** 新建工程诊断逐条记录来源失败与未提取脚本的位置。 */
  private log_create_commit_parse_diagnostics(draft: SourceFileProjectDraft): void {
    log_source_file_diagnostics({
      failures: draft.failures,
      warnings: draft.warnings,
      log_manager: this.log_manager,
      source: "project-lifecycle",
    });
  }

  /**
   * 新建预过滤直接消费解析草稿，在此校验并转换条目字段。
   */
  private prefilter_create_project_items(
    draft: SourceFileProjectDraft,
    settings: ProjectSettings,
  ): Record<string, ProjectItemPublicRecord> {
    return compute_project_prefilter_items({
      state: {
        files: Object.fromEntries(draft.files.map((file) => [file.rel_path, file])),
        items: Object.fromEntries(
          draft.items.map((item) => {
            const record = this.normalize_public_item(item);
            return [String(record.item_id), record];
          }),
        ),
      },
      ...settings,
    });
  }

  /**
   * 新建工程解析使用本次选择的项目语言
   */
  private create_format_service(languages: ProjectLanguageSettings): FileFormatService {
    return new FileFormatService(
      this.game_directory_operations,
      {
        target_language: languages.target_language,
      },
      this.native_fs,
      this.game_prepare_execution,
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
   * 读取 .lg 摘要预览，不加载工程会话
   */
  public async get_project_preview(body: JsonRecord): Promise<ProjectPreviewResponse> {
    const project_path = this.require_body_string(body, "path");
    return { preview: await this.database.read_project_preview(project_path) };
  }

  /** AGENT 创建只需要名称，避免为命名扫描或解析待导入来源。 */
  public get_default_project_name(
    body: JsonRecord,
  ): Pick<ProjectSourceFileSummary, "project_name"> {
    return {
      project_name: this.build_default_project_name(
        this.normalize_source_paths(body["source_paths"]),
      ),
    };
  }

  /** 汇总可导入文件计数与格式，命名与 AGENT 拖入创建共用同一规则。 */
  public async summarize_source_files(body: JsonRecord): Promise<ProjectSourceFileSummary> {
    const source_paths = this.normalize_source_paths(body["source_paths"]);
    // 来源摘要只统计格式命中，项目语言尚未选择时使用默认值。
    const summary = await this.create_format_service(
      DEFAULT_PROJECT_LANGUAGE_SETTINGS,
    ).summarize_source_files(source_paths);
    return { ...summary, project_name: this.build_default_project_name(source_paths) };
  }

  /** 默认名由能判断文件类型的后端生成，落盘后只以 `.lg` 文件名为工程名。 */
  private build_default_project_name(source_paths: string[]): string {
    const first = source_paths[0];
    if (first === undefined) return "";
    if (source_paths.length > 1) return path.basename(path.dirname(first));
    return this.native_fs.stat(first).isDirectory() ? path.basename(first) : path.parse(first).name;
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
   * 生成更新时间戳，复用 ISO 字符串让 服务层与 database 摘要可排序
   */
  private build_timestamp(): string {
    return new Date().toISOString();
  }
}
