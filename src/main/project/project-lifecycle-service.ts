import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import { ProjectCompatibilityMigrationService } from "../migration/project-compatibility-migration-service";
import type { SettingService } from "../service/setting-service";
import type { AppPathService } from "../service/path-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { Item } from "../../base/item";
import { get_runtime_section_revision } from "./project-section-revision";
import { ProjectSessionState } from "./project-session-state";
import * as AppErrors from "../../shared/error";

// 公开 source-files 只枚举当前文件域已经支持的格式，避免新建工程误收未知文件
const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".xlsx",
  ".epub",
  ".ass",
  ".srt",
  ".rpy",
  ".trans",
]);

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;
type JsonRecordLike = Record<string, ApiJsonValue | DatabaseJsonValue | undefined>;

interface CreateCommitFileRecord {
  rel_path: string; // rel_path 是 .lg 内 asset 的唯一业务路径，不能用源文件绝对路径替代
  source_path: string; // source_path 只传给 database workflow 读取 bytes，项目域不理解压缩格式
  sort_index: number; // sort_index 决定工作台文件顺序，必须随 asset 一起落库
}

interface QualityDefaultPresetSpec {
  config_key: string; // config_key 对应用户设置里的默认预设虚拟 ID
  preset_directory: string; // preset_directory 决定内置和用户预设目录
  rule_type: string; // rule_type 是 rules 表当前物理类型
  meta_key: string; // meta_key 表示预设成功加载后需要同步开启的工程设置
  meta_value: DatabaseJsonValue; // meta_value 是预设启用后的工程设置值
  display_name: string; // display_name 只用于日志，不进入公开协议
}

interface PromptDefaultPresetSpec {
  config_key: string; // config_key 对应翻译或分析提示词默认预设
  task_type: "translation" | "analysis"; // task_type 由 AppPathService 映射到 prompt 目录
  rule_type: string; // rule_type 是 rules 表当前提示词物理类型
  meta_key: string; // meta_key 控制提示词启用态
  display_name: string; // display_name 只用于日志，不进入公开协议
}

const QUALITY_DEFAULT_PRESET_SPECS: QualityDefaultPresetSpec[] = [
  {
    config_key: "glossary_default_preset",
    preset_directory: "glossary",
    rule_type: "glossary",
    meta_key: "glossary_enable",
    meta_value: true,
    display_name: "术语表",
  },
  {
    config_key: "text_preserve_default_preset",
    preset_directory: "text_preserve",
    rule_type: "text_preserve",
    meta_key: "text_preserve_mode",
    meta_value: "custom",
    display_name: "文本保护",
  },
  {
    config_key: "pre_translation_replacement_default_preset",
    preset_directory: "pre_translation_replacement",
    rule_type: "pre_translation_replacement",
    meta_key: "pre_translation_replacement_enable",
    meta_value: true,
    display_name: "译前替换",
  },
  {
    config_key: "post_translation_replacement_default_preset",
    preset_directory: "post_translation_replacement",
    rule_type: "post_translation_replacement",
    meta_key: "post_translation_replacement_enable",
    meta_value: true,
    display_name: "译后替换",
  },
];

const PROMPT_DEFAULT_PRESET_SPECS: PromptDefaultPresetSpec[] = [
  {
    config_key: "translation_custom_prompt_default_preset",
    task_type: "translation",
    rule_type: "translation_prompt",
    meta_key: "translation_prompt_enable",
    display_name: "翻译提示词",
  },
  {
    config_key: "analysis_custom_prompt_default_preset",
    task_type: "analysis",
    rule_type: "analysis_prompt",
    meta_key: "analysis_prompt_enable",
    display_name: "分析提示词",
  },
];

/**
 * 承载 项目轻生命周期公开接口，公开 loaded/path 与 .lg 写入边界都在这里收口
 */
export class ProjectLifecycleService {
  private readonly database: ProjectDatabase; // database 是 .lg 物理事实唯一写入口，项目域只拼受限 operation

  private readonly session_state: ProjectSessionState; // session_state 是 renderer 可见 loaded/path 的唯一权威

  private readonly setting_service: SettingService; // setting_service 提供当前应用设置，用于打开预演与默认预设选择

  private readonly paths: AppPathService; // paths 统一解析内置 / 用户预设目录，避免项目域拼第二套路由规则

  private readonly log_manager: LogManager; // log_manager 记录默认预设初始化结果，响应体不扩大公开协议

  private readonly compatibility_migration_service: ProjectCompatibilityMigrationService; // compatibility_migration_service 只生成兼容写回操作，事务仍由生命周期入口持有

  /**
   * 初始化项目生命周期依赖，保持公开路由层只负责装配
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    setting_service: SettingService,
    paths: AppPathService,
    log_manager: LogManager,
  ) {
    this.database = database;
    this.session_state = session_state;
    this.setting_service = setting_service;
    this.paths = paths;
    this.log_manager = log_manager;
    this.compatibility_migration_service = new ProjectCompatibilityMigrationService(
      database,
      setting_service,
    );
  }

  /**
   * 读取当前工程快照；公开 loaded/path 只来自 会话权威
   */
  public async get_project_snapshot(): Promise<Record<string, ApiJsonValue>> {
    const state = this.session_state.snapshot();
    return {
      project: {
        path: state.projectPath,
        loaded: state.loaded,
      },
    };
  }

  /**
   * 加载既有 .lg，并在标记 会话前完成打开期兼容迁移
   */
  public async load_project(
    body: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const project_path = this.require_body_string(body, "path");
    this.assert_project_file_exists(project_path);
    const compatibility_operations =
      await this.compatibility_migration_service.build_open_compatibility_operations(project_path);

    this.database.execute_transaction([
      this.op("setMeta", {
        projectPath: project_path,
        key: "updated_at",
        value: this.build_timestamp(),
      }),
      ...compatibility_operations,
    ]);
    this.session_state.mark_loaded(project_path);
    return this.build_loaded_project_response(project_path);
  }

  /**
   * 把前端预过滤后的新建工程草稿写入 .lg，并复用 load_project 进入 loaded 状态
   */
  public async create_project_commit(
    body: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const project_path = this.require_body_string(body, "path");
    const source_paths = this.normalize_string_list(body["source_paths"]);
    const draft = this.normalize_object(body["draft"]);
    const files = this.normalize_create_commit_files(draft["files"]);
    const items = this.normalize_full_items(draft["items"]);
    const project_settings = this.normalize_object(body["project_settings"]);
    const translation_extras = this.normalize_object(body["translation_extras"]);
    const prefilter_config = this.normalize_object(body["prefilter_config"]);
    const default_preset_result = this.build_default_preset_initialization_operations(project_path);

    this.database.execute_transaction([
      this.op("createProject", {
        projectPath: project_path,
        name: this.build_project_name(source_paths, project_path),
      }),
      ...default_preset_result.operations,
      ...this.build_asset_operations(project_path, files),
      this.op("setItems", {
        projectPath: project_path,
        items: items as unknown as DatabaseJsonValue,
      }),
      this.op("upsertMetaEntries", {
        projectPath: project_path,
        meta: this.build_project_settings_meta({
          project_settings,
          translation_extras,
          prefilter_config,
        }) as unknown as DatabaseJsonValue,
      }),
    ]);

    const response = await this.load_project({ path: project_path });
    this.log_loaded_default_presets(default_preset_result.loaded_names);
    return response;
  }

  /**
   * 读取打开工程前的设置对齐预演，不进入 loaded 状态，也不写运行态事实
   */
  public get_open_alignment_preview(
    body: Record<string, ApiJsonValue>,
  ): Record<string, ApiJsonValue> {
    const project_path = this.require_body_string(body, "path");
    this.assert_project_file_exists(project_path);

    const meta = this.get_all_meta(project_path);
    const prefilter_config = this.normalize_object(meta["prefilter_config"] as ApiJsonValue);
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
        draft: needs_prefiltered_items ? this.build_project_draft(project_path, meta) : null,
      },
    };
  }

  /**
   * 卸载公开工程会话，并释放 database 缓存句柄
   */
  public async unload_project(): Promise<Record<string, ApiJsonValue>> {
    const state = this.session_state.snapshot();
    this.session_state.clear();
    if (state.loaded && state.projectPath !== "") {
      this.database.execute({
        name: "closeProject",
        args: { projectPath: state.projectPath },
      });
    }
    return {
      project: {
        path: "",
        loaded: false,
      },
    };
  }

  /**
   * 读取 .lg 摘要预览，不加载工程会话
   */
  public get_project_preview(body: Record<string, ApiJsonValue>): Record<string, ApiJsonValue> {
    const project_path = this.require_body_string(body, "path");
    this.assert_project_file_exists(project_path);
    const summary = this.to_record(
      this.database.execute({
        name: "getProjectSummary",
        args: { projectPath: project_path },
      }),
    );
    return {
      preview: {
        path: project_path,
        name: this.string_field(summary, "name"),
        source_language: this.string_field(summary, "source_language"),
        target_language: this.string_field(summary, "target_language"),
        file_count: this.number_field(summary, "file_count"),
        created_at: this.string_field(summary, "created_at"),
        updated_at: this.string_field(summary, "updated_at"),
        translation_stats: this.normalize_translation_stats(summary["translation_stats"]),
      },
    };
  }

  /**
   * 按用户选择顺序枚举可导入源文件，保持源路径去重和真实文件去重一致
   */
  public collect_source_files(body: Record<string, ApiJsonValue>): Record<string, ApiJsonValue> {
    const source_paths = this.normalize_source_paths(body["source_paths"]);
    const source_files: string[] = [];
    const seen_file_keys = new Set<string>();
    for (const source_path of source_paths) {
      for (const source_file of this.collect_source_files_from_path(source_path)) {
        const file_key = this.build_path_identity_key(source_file);
        if (seen_file_keys.has(file_key)) {
          continue;
        }
        seen_file_keys.add(file_key);
        source_files.push(source_file);
      }
    }
    return { source_files };
  }

  /**
   * 构建新建工程默认预设初始化操作，单个预设失败只记录日志并继续创建
   */
  private build_default_preset_initialization_operations(project_path: string): {
    operations: DatabaseOperation[];
    loaded_names: string[];
  } {
    const config = this.setting_service.load_setting();
    const operations: DatabaseOperation[] = [
      this.op("setMeta", {
        projectPath: project_path,
        key: "text_preserve_mode",
        value: "smart",
      }),
    ];
    const loaded_names: string[] = [];

    for (const spec of QUALITY_DEFAULT_PRESET_SPECS) {
      const virtual_id = this.string_value(config[spec.config_key]);
      if (virtual_id === "") {
        continue;
      }
      try {
        const entries = this.read_quality_rule_preset(spec.preset_directory, virtual_id);
        operations.push(
          this.op("setRules", {
            projectPath: project_path,
            ruleType: spec.rule_type,
            rules: entries as unknown as DatabaseJsonValue,
          }),
          this.op("setMeta", {
            projectPath: project_path,
            key: spec.meta_key,
            value: spec.meta_value,
          }),
        );
        loaded_names.push(spec.display_name);
      } catch (error) {
        this.log_non_blocking_project_lifecycle_warning(
          t_main_log("app.diagnostic.default_preset.quality_rule_load_failed"),
          error,
          {
            preset_directory: spec.preset_directory,
            virtual_id,
          },
        );
      }
    }

    for (const spec of PROMPT_DEFAULT_PRESET_SPECS) {
      const virtual_id = this.string_value(config[spec.config_key]);
      if (virtual_id === "") {
        continue;
      }
      try {
        operations.push(
          this.op("setRuleText", {
            projectPath: project_path,
            ruleType: spec.rule_type,
            text: this.read_prompt_preset(spec.task_type, virtual_id),
          }),
          this.op("setMeta", {
            projectPath: project_path,
            key: spec.meta_key,
            value: true,
          }),
        );
        loaded_names.push(spec.display_name);
      } catch (error) {
        this.log_non_blocking_project_lifecycle_warning(
          t_main_log("app.diagnostic.default_preset.prompt_load_failed"),
          error,
          {
            task_type: spec.task_type,
            virtual_id,
          },
        );
      }
    }

    return { operations, loaded_names };
  }

  /**
   * 读取质量规则预设，并把非对象条目过滤掉
   */
  private read_quality_rule_preset(
    preset_directory: string,
    virtual_id: string,
  ): MutableJsonRecord[] {
    const preset_path = this.resolve_quality_rule_preset_path(preset_directory, virtual_id);
    const data = JsonTool.parseStrict(fs.readFileSync(preset_path)) as unknown;
    if (!Array.isArray(data)) {
      throw new AppErrors.RequestValidationError({
        public_details: {
          filename: path.basename(preset_path),
        },
      });
    }
    return data.filter((entry): entry is MutableJsonRecord => this.is_record(entry));
  }

  /**
   * 读取提示词预设正文，统一去掉 BOM 与首尾空白
   */
  private read_prompt_preset(task_type: "translation" | "analysis", virtual_id: string): string {
    const preset_path = this.resolve_prompt_preset_path(task_type, virtual_id);
    return fs
      .readFileSync(preset_path, "utf-8")
      .replace(/^\uFEFF/, "")
      .trim();
  }

  /**
   * 解析质量规则预设虚拟 ID 到真实路径
   */
  private resolve_quality_rule_preset_path(preset_directory: string, virtual_id: string): string {
    const { source, file_name } = this.split_virtual_id(virtual_id, ".json");
    const directory =
      source === "builtin"
        ? this.paths.get_quality_rule_builtin_preset_dir(preset_directory)
        : this.paths.get_quality_rule_user_preset_dir(preset_directory);
    return path.join(directory, file_name);
  }

  /**
   * 解析提示词预设虚拟 ID 到真实路径
   */
  private resolve_prompt_preset_path(
    task_type: "translation" | "analysis",
    virtual_id: string,
  ): string {
    const { source, file_name } = this.split_virtual_id(virtual_id, ".txt");
    const directory =
      source === "builtin"
        ? this.paths.get_prompt_builtin_preset_dir(task_type)
        : this.paths.get_prompt_user_preset_dir(task_type);
    return path.join(directory, file_name);
  }

  /**
   * 拆分虚拟 ID，集中保护 preset 文件名不能逃逸目录
   */
  private split_virtual_id(
    virtual_id: string,
    extension: ".json" | ".txt",
  ): { source: "builtin" | "user"; file_name: string } {
    const parts = virtual_id.split(":");
    if (parts.length !== 2 && !(extension === ".json" && parts.length === 3)) {
      throw new AppErrors.RequestValidationError();
    }
    const source = parts[0];
    const file_name = parts.at(-1) ?? "";
    if (source !== "builtin" && source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    this.ensure_preset_file_name(file_name, extension);
    return { source, file_name };
  }

  /**
   * 校验预设文件名，避免用户配置值被解释成任意文件路径
   */
  private ensure_preset_file_name(file_name: string, extension: ".json" | ".txt"): void {
    const has_path_boundary =
      path.basename(file_name) !== file_name ||
      path.win32.basename(file_name) !== file_name ||
      path.posix.basename(file_name) !== file_name ||
      path.isAbsolute(file_name) ||
      path.win32.isAbsolute(file_name) ||
      path.posix.isAbsolute(file_name);
    if (file_name === "" || has_path_boundary || !file_name.toLowerCase().endsWith(extension)) {
      throw new AppErrors.RequestValidationError();
    }
  }

  /**
   * 记录不阻断当前主流程的生命周期错误，保留上下文供日志窗口排查
   */
  private log_non_blocking_project_lifecycle_warning(
    message: string,
    error: unknown,
    context: Record<string, unknown>,
  ): void {
    this.log_manager.warning(message, {
      source: "project-lifecycle",
      context,
      error_message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  /**
   * 记录成功加载的默认预设名；为空时不写日志，避免制造噪声
   */
  private log_loaded_default_presets(loaded_names: string[]): void {
    if (loaded_names.length === 0) {
      return;
    }
    this.log_manager.info(
      t_main_log("app.log.default_preset_loaded", { NAMES: loaded_names.join(" | ") }),
      {
        source: "project-lifecycle",
      },
    );
  }

  /**
   * 构建 asset 写入操作，跳过缺少源文件路径的草稿记录
   */
  private build_asset_operations(
    project_path: string,
    files: CreateCommitFileRecord[],
  ): DatabaseOperation[] {
    return [...files]
      .sort((left, right) => left.sort_index - right.sort_index)
      .filter((file) => file.rel_path !== "" && file.source_path !== "")
      .map((file) =>
        this.op("addAssetFromSource", {
          projectPath: project_path,
          path: file.rel_path,
          sourcePath: file.source_path,
          sortOrder: file.sort_index,
        }),
      );
  }

  /**
   * 构建工程设置镜像 meta，同时把预过滤配置补齐当前项目设置快照
   */
  private build_project_settings_meta(args: {
    project_settings: MutableJsonRecord;
    translation_extras: MutableJsonRecord;
    prefilter_config: MutableJsonRecord;
  }): MutableJsonRecord {
    const source_language = this.string_value(args.project_settings["source_language"]);
    const mtool_optimizer_enable = this.boolean_value(
      args.project_settings["mtool_optimizer_enable"],
    );
    const skip_duplicate_source_text_enable = this.boolean_value_with_default(
      args.project_settings["skip_duplicate_source_text_enable"],
      true,
    );
    return {
      source_language,
      target_language: this.string_value(args.project_settings["target_language"]),
      mtool_optimizer_enable,
      skip_duplicate_source_text_enable,
      prefilter_config: {
        ...args.prefilter_config,
        source_language,
        mtool_optimizer_enable,
        skip_duplicate_source_text_enable,
      },
      translation_extras: args.translation_extras,
      analysis_extras: {},
      analysis_candidate_count: 0,
    };
  }

  /**
   * 从数据库事实重建打开前预过滤草稿，供 renderer 在未 loaded 时运行 planner
   */
  private build_project_draft(project_path: string, meta: MutableJsonRecord): MutableJsonRecord {
    const asset_records = this.get_asset_records(project_path);
    const items = this.get_all_items(project_path);
    const file_type_by_path = new Map<string, string>();
    for (const item of items) {
      const rel_path = this.string_value(item["file_path"]);
      if (rel_path !== "") {
        file_type_by_path.set(rel_path, this.string_value(item["file_type"]) || "NONE");
      }
    }
    return {
      files: asset_records.map((record) => ({
        rel_path: record.path,
        file_type: file_type_by_path.get(record.path) ?? "NONE",
        sort_index: record.sort_order,
      })),
      items: items as unknown as ApiJsonValue,
      section_revisions: {
        files: get_runtime_section_revision(meta, "files"),
        items: get_runtime_section_revision(meta, "items"),
        analysis: get_runtime_section_revision(meta, "analysis"),
      },
    };
  }

  /**
   * 读取当前应用设置，作为打开前 settings alignment 的目标值
   */
  private build_current_project_settings(): {
    source_language: string;
    target_language: string;
    mtool_optimizer_enable: boolean;
    skip_duplicate_source_text_enable: boolean;
  } {
    const config = this.setting_service.load_setting();
    return {
      source_language: this.string_value(config["source_language"]) || "JA",
      target_language: this.string_value(config["target_language"]) || "ZH",
      mtool_optimizer_enable: this.boolean_value_with_default(
        config["mtool_optimizer_enable"],
        true,
      ),
      skip_duplicate_source_text_enable: this.boolean_value_with_default(
        config["skip_duplicate_source_text_enable"],
        true,
      ),
    };
  }

  /**
   * 读取项目内设置镜像，优先当前 meta，缺失时回退 prefilter_config
   */
  private build_stored_project_settings(
    meta: MutableJsonRecord,
    prefilter_config: MutableJsonRecord,
  ): {
    source_language: string;
    target_language: string;
    mtool_optimizer_enable: boolean;
    skip_duplicate_source_text_enable: boolean;
  } {
    return {
      source_language: this.string_value(meta["source_language"]),
      target_language: this.string_value(meta["target_language"]),
      mtool_optimizer_enable: this.boolean_value_with_default(
        meta["mtool_optimizer_enable"] ?? prefilter_config["mtool_optimizer_enable"],
        false,
      ),
      skip_duplicate_source_text_enable: this.boolean_value_with_default(
        meta["skip_duplicate_source_text_enable"] ??
          prefilter_config["skip_duplicate_source_text_enable"],
        true,
      ),
    };
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
   * 构建 loaded 响应，保持公开项目快照形状不扩大
   */
  private build_loaded_project_response(project_path: string): Record<string, ApiJsonValue> {
    return {
      project: {
        path: project_path,
        loaded: true,
      },
    };
  }

  /**
   * 归一 create-commit 文件草稿，防止脏 sort_index 影响 asset 顺序
   */
  private normalize_create_commit_files(value: ApiJsonValue | undefined): CreateCommitFileRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => this.is_record(item))
      .map((item, index) => ({
        rel_path: this.string_value(item["rel_path"]),
        source_path: this.string_value(item["source_path"]),
        sort_index: this.number_value(item["sort_index"], index),
      }));
  }

  /**
   * 全量 items 写入前做最小字段归一，兼容 planner 已算出的完整 payload
   */
  private normalize_full_items(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => this.is_record(item))
      .map((item) => this.normalize_item_payload(item));
  }

  /**
   * 归一单条 item，保护状态和数字字段，同时保留 EPUB 等格式 extra_field
   */
  private normalize_item_payload(item: JsonRecord): MutableJsonRecord {
    const normalized: MutableJsonRecord = {
      ...item,
      src: this.string_value(item["src"]),
      dst: this.string_value(item["dst"]),
      name_src: item["name_src"] ?? null,
      name_dst: item["name_dst"] ?? null,
      extra_field: item["extra_field"] ?? "",
      tag: this.string_value(item["tag"]),
      row: this.number_value(item["row"] ?? item["row_number"], 0),
      file_type: this.string_value(item["file_type"]) || "NONE",
      file_path: this.string_value(item["file_path"]),
      text_type: this.string_value(item["text_type"]) || "NONE",
      status: Item.normalize_status(item["status"]),
      retry_count: this.number_value(item["retry_count"], 0),
      skip_internal_filter: item["skip_internal_filter"] === true,
    };
    if (item["id"] !== undefined && item["id"] !== null && item["id"] !== "") {
      normalized["id"] = this.number_value(item["id"], 0);
    }
    return normalized;
  }

  /**
   * 归一 source_paths，保持用户选择顺序和去重语义一致
   */
  private normalize_source_paths(value: ApiJsonValue | undefined): string[] {
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
  private normalize_string_list(value: ApiJsonValue | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }

  /**
   * 按文件或目录收集支持格式，目录内按名称稳定排序
   */
  private collect_source_files_from_path(source_path: string): string[] {
    if (!fs.existsSync(source_path)) {
      return [];
    }
    const stats = fs.statSync(source_path);
    if (stats.isFile()) {
      return this.is_supported_file(source_path) ? [source_path] : [];
    }
    if (!stats.isDirectory()) {
      return [];
    }
    return this.collect_source_files_from_directory(source_path);
  }

  /**
   * 递归目录时保持确定性顺序，让新建草稿和后续 asset 顺序可重复
   */
  private collect_source_files_from_directory(source_path: string): string[] {
    const source_files: string[] = [];
    const entries = fs
      .readdirSync(source_path, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entry_path = path.join(source_path, entry.name);
      if (entry.isDirectory()) {
        source_files.push(...this.collect_source_files_from_directory(entry_path));
      } else if (entry.isFile() && this.is_supported_file(entry_path)) {
        source_files.push(entry_path);
      }
    }
    return source_files;
  }

  /**
   * 判断文件扩展名是否属于公开文件域支持集合
   */
  private is_supported_file(file_path: string): boolean {
    return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(file_path).toLowerCase());
  }

  /**
   * 构造跨平台路径身份 key，Windows 下按文件系统大小写不敏感处理
   */
  private build_path_identity_key(source_path: string): string {
    const resolved_path = path.resolve(source_path);
    return process.platform === "win32" ? resolved_path.toLowerCase() : resolved_path;
  }

  /**
   * 校验请求体字符串字段，避免空 path 触发 SQLite 静默建库
   */
  private require_body_string(body: Record<string, ApiJsonValue>, key: string): string {
    const value = body[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new AppErrors.RequestValidationError();
    }
    return value;
  }

  /**
   * 打开既有工程前必须先确认文件存在，缺失时映射为 project.not_found
   */
  private assert_project_file_exists(project_path: string): void {
    if (!fs.existsSync(project_path)) {
      throw new AppErrors.ProjectNotFoundError({
        public_details: { filename: path.basename(project_path) },
      });
    }
  }

  /**
   * 读取全部 meta，用于打开预演、兼容处理和 section revision
   */
  private get_all_meta(project_path: string): MutableJsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })) as ApiJsonValue,
    );
  }

  /**
   * 读取所有 item，供打开前草稿重建
   */
  private get_all_items(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(this.op("getAllItems", { projectPath: project_path }));
    return Array.isArray(value)
      ? value.filter((item): item is MutableJsonRecord => this.is_record(item))
      : [];
  }

  /**
   * 读取 asset 顺序记录，隐藏 database 返回结构
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
        path: this.string_value(item["path"]),
        sort_order: this.number_value(item["sort_order"], 0),
      }));
  }

  /**
   * 归一翻译进度摘要，公开 preview 不透出数据库内部额外字段
   */
  private normalize_translation_stats(value: DatabaseJsonValue | ApiJsonValue | undefined) {
    const stats = this.to_record(value);
    return {
      total_items: this.number_field(stats, "total_items"),
      completed_count: this.number_field(stats, "completed_count"),
      failed_count: this.number_field(stats, "failed_count"),
      pending_count: this.number_field(stats, "pending_count"),
      skipped_count: this.number_field(stats, "skipped_count"),
      completion_percent: this.number_field(stats, "completion_percent"),
    };
  }

  /**
   * 把未知 JSON 值收窄为对象，避免深层读取扩散类型断言
   */
  private normalize_object(value: ApiJsonValue | DatabaseJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 收窄未知 JSON 对象，保护数组和 null 不被当作 record
   */
  private is_record(value: unknown): value is MutableJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * preview 摘要字段读取使用宽类型，兼容 database 返回值与 API 值
   */
  private to_record(value: DatabaseJsonValue | ApiJsonValue | undefined): JsonRecordLike {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return value as JsonRecordLike;
  }

  /**
   * 从对象字段读取字符串，避免 undefined 泄漏到响应体
   */
  private string_field(record: JsonRecordLike, key: string): string {
    return this.string_value(record[key]);
  }

  /**
   * 从对象字段读取数字，避免 NaN 泄漏到响应体
   */
  private number_field(record: JsonRecordLike, key: string): number {
    return this.number_value(record[key], 0);
  }

  /**
   * 从未知值读取字符串，保持 null / undefined 统一为空串
   */
  private string_value(value: ApiJsonValue | DatabaseJsonValue | undefined): string {
    return typeof value === "string" ? value : String(value ?? "");
  }

  /**
   * 从未知值读取数字，非法数字回落到调用方提供的默认值
   */
  private number_value(
    value: ApiJsonValue | DatabaseJsonValue | undefined,
    fallback: number,
  ): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? number_value : fallback;
  }

  /**
   * 从未知值读取布尔值，使用 bool(...) 宽松转换
   */
  private boolean_value(value: ApiJsonValue | DatabaseJsonValue | undefined): boolean {
    return Boolean(value ?? false);
  }

  /**
   * 从未知值读取带默认值的布尔，缺失时保持项目默认语义
   */
  private boolean_value_with_default(
    value: ApiJsonValue | DatabaseJsonValue | undefined,
    fallback: boolean,
  ): boolean {
    return value === undefined || value === null ? fallback : Boolean(value);
  }

  /**
   * 生成更新时间戳，复用 ISO 字符串让 服务层与 database 摘要可排序
   */
  private build_timestamp(): string {
    return new Date().toISOString();
  }

  /**
   * 创建 database workflow 操作，并允许 create-commit 模板稍后补齐 projectPath
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
