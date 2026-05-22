import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import { FileFormatService } from "../file/file-format-service";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import { migration_orchestrator } from "../migration/migration-orchestrator";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { AppSettingService } from "../app/app-setting-service";
import type { AppPathService } from "../app/app-path-service";
import { JsonTool } from "../../shared/utils/json-tool";
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
import {
  build_analysis_progress_snapshot,
  compute_project_prefilter_mutation,
  create_empty_translation_task_snapshot,
  type ProjectPrefilterMutationOutput,
} from "./project-mutation-state";
import { get_runtime_section_revision } from "./project-section-revision";
import { ProjectSessionState } from "./project-session-state";
import * as AppErrors from "../../shared/error";
import type { SourceFileParseFailureRecord } from "../../shared/source-file-parse-failure";
import {
  build_source_file_parse_failure,
  log_source_file_parse_failures,
} from "../file/source-file-parse-failure-reporter";

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

type MutableJsonRecord = Record<string, ApiJsonValue>;
type JsonRecordLike = Record<string, ApiJsonValue | DatabaseJsonValue | undefined>;

interface CreateCommitFileRecord {
  rel_path: string; // rel_path 是 .lg 内 asset 的唯一业务路径，不能用源文件绝对路径替代
  source_path: string; // source_path 只传给 database workflow 读取 bytes，项目域不理解压缩格式
  sort_index: number; // sort_index 决定工作台文件顺序，必须随 asset 一起落库
}

interface CreateCommitParsedDraft {
  files: CreateCommitFileRecord[]; // files 是后端从 source_paths 解析出的可信 asset 写入清单
  failed_files: SourceFileParseFailureRecord[]; // failed_files 只记录支持格式但解析失败的源文件
  file_state: Record<string, unknown>; // file_state 只供后端预过滤算法识别文件类型和相对路径
  items: Record<string, ProjectItemPublicRecord>; // items 是后端生成的完整公开 DTO 镜像
}

type ProjectMutationSettings = ProjectSettingsSnapshot; // 项目生命周期只消费设置领域定义的项目镜像窄字段

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

  private readonly app_setting_service: AppSettingService; // app_setting_service 提供当前应用设置，用于打开预演与默认预设选择

  private readonly paths: AppPathService; // paths 统一解析内置 / 用户预设目录，避免项目域拼第二套路由规则

  private readonly log_manager: LogManager; // log_manager 记录默认预设初始化结果，响应体不扩大公开协议

  private readonly native_fs: NativeFs; // native_fs 是项目域读取外部文件和校验 .lg 路径的唯一文件系统门面

  /**
   * 初始化项目生命周期依赖，保持公开路由层只负责装配
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    app_setting_service: AppSettingService,
    paths: AppPathService,
    log_manager: LogManager,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.database = database;
    this.session_state = session_state;
    this.app_setting_service = app_setting_service;
    this.paths = paths;
    this.log_manager = log_manager;
    this.native_fs = native_fs;
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
   * 加载既有 .lg，并在标记会话 loaded 前完成打开期 operation 迁移
   */
  public async load_project(
    body: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const project_path = this.require_body_string(body, "path");
    this.assert_project_file_exists(project_path);
    // 打开期迁移只生成 operation，和 updated_at 一起提交后才暴露 loaded 状态
    const migration_operations = await migration_orchestrator.build_project_open_operations({
      project_path,
      database: this.database,
      app_setting_service: this.app_setting_service,
    });

    this.database.execute_transaction([
      this.op("setMeta", {
        projectPath: project_path,
        key: "updated_at",
        value: this.build_timestamp(),
      }),
      ...migration_operations,
    ]);
    this.session_state.mark_loaded(project_path);
    return this.build_loaded_project_response(project_path);
  }

  /**
   * 后端按用户源路径生成新建工程事实，并复用 load_project 进入 loaded 状态
   */
  public async create_project_commit(
    body: Record<string, ApiJsonValue>,
  ): Promise<Record<string, ApiJsonValue>> {
    const project_path = this.require_body_string(body, "path");
    this.assert_no_legacy_create_commit_fields(body);
    const source_paths = this.normalize_source_paths(body["source_paths"]);
    const project_settings = this.read_create_project_settings(body["project_settings"]);
    // parsed_draft 是后端重新解析源文件得到的唯一可信新建草稿。
    const parsed_draft = await this.build_create_commit_parsed_draft(
      source_paths,
      project_settings,
    );
    this.assert_create_commit_has_importable_files(parsed_draft);
    // prefilter_output 是将可信草稿转成持久项目事实的唯一派生结果。
    const prefilter_output = this.compute_create_project_prefilter_output({
      draft: parsed_draft,
      settings: project_settings,
    });
    const default_preset_result = this.build_default_preset_initialization_operations(project_path);

    this.database.execute_transaction([
      this.op("createProject", {
        projectPath: project_path,
        name: this.build_project_name(source_paths, project_path),
      }),
      ...default_preset_result.operations,
      ...this.build_asset_operations(project_path, parsed_draft.files),
      this.op("setItems", {
        projectPath: project_path,
        items: this.persistent_items_from_public_record(prefilter_output.items),
      }),
      this.op("upsertMetaEntries", {
        projectPath: project_path,
        meta: this.build_project_settings_meta({
          project_settings,
          prefilter_output,
        }) as unknown as DatabaseJsonValue,
      }),
    ]);

    const response = await this.load_project({ path: project_path });
    this.log_create_commit_parse_failures(parsed_draft.failed_files);
    this.log_loaded_default_presets(default_preset_result.loaded_names);
    return this.build_create_project_response(response, parsed_draft.failed_files);
  }

  /**
   * 新建工程提交不接受旧前端事实字段，避免恢复 renderer 写库能力
   */
  private assert_no_legacy_create_commit_fields(body: Record<string, ApiJsonValue>): void {
    for (const field of [
      "draft",
      "files",
      "items",
      "translation_extras",
      "prefilter_config",
      "analysis_extras",
      "parsed_items",
      "file_record",
    ]) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "legacy_create_commit_field", field },
        });
      }
    }
  }

  /**
   * 读取 create-commit 设置镜像；缺字段时回到当前应用设置，保持空请求可创建空工程
   */
  private read_create_project_settings(value: ApiJsonValue | undefined): ProjectMutationSettings {
    const current = this.build_current_project_settings();
    return normalize_project_settings_snapshot(value, current);
  }

  /**
   * create-commit 重新读取源文件并分配 item id，最终事实只由后端生成
   */
  private async build_create_commit_parsed_draft(
    source_paths: string[],
    project_settings: ProjectMutationSettings,
  ): Promise<CreateCommitParsedDraft> {
    const format_service = this.create_format_service(project_settings);
    const source_files = format_service.collect_source_file_entries(source_paths);
    const files: CreateCommitFileRecord[] = [];
    // file_state 只保留后端预过滤所需字段，不能携带源文件绝对路径进入项目事实。
    const file_state: Record<string, unknown> = {};
    const items: Record<string, ProjectItemPublicRecord> = {};
    const failed_files: SourceFileParseFailureRecord[] = [];
    // next_item_id 由后端顺序分配，避免 renderer 伪造数据库主键。
    let next_item_id = 1;
    let next_sort_index = 0;

    for (const source_file of source_files) {
      let parsed_items: Item[];
      try {
        parsed_items = await format_service.parse_asset(
          source_file.rel_path,
          this.native_fs.read_file(source_file.source_path),
        );
      } catch (error) {
        failed_files.push(
          build_source_file_parse_failure({
            source_path: source_file.source_path,
            rel_path: source_file.rel_path,
            error,
          }),
        );
        continue;
      }
      const file_type = format_service.pick_file_type(parsed_items);
      files.push({
        rel_path: source_file.rel_path,
        source_path: source_file.source_path,
        sort_index: next_sort_index,
      });
      file_state[source_file.rel_path] = {
        rel_path: source_file.rel_path,
        file_type,
        sort_index: next_sort_index,
      };
      next_sort_index += 1;
      for (const parsed_item of parsed_items) {
        const public_item = this.normalize_public_item({
          ...Item.from_json(parsed_item).to_json(),
          id: next_item_id,
          file_path: source_file.rel_path,
        });
        items[String(public_item.item_id)] = public_item;
        next_item_id += 1;
      }
    }

    return { files, failed_files, file_state, items };
  }

  /**
   * 只在存在候选源文件且全部解析失败时阻断；空工程创建仍保留原有测试和内部语义。
   */
  private assert_create_commit_has_importable_files(draft: CreateCommitParsedDraft): void {
    if (draft.files.length > 0 || draft.failed_files.length === 0) {
      return;
    }
    this.log_create_commit_parse_failures(draft.failed_files);
    throw new AppErrors.FileParseFailedError({
      public_details: { failed_files: draft.failed_files as unknown as ApiJsonValue },
      diagnostic_context: { reason: "all_source_files_parse_failed" },
    });
  }

  /**
   * 新建工程成功响应只在确实跳过文件时附带失败明细，避免成功空列表污染旧调用点。
   */
  private build_create_project_response(
    response: Record<string, ApiJsonValue>,
    failed_files: SourceFileParseFailureRecord[],
  ): Record<string, ApiJsonValue> {
    if (failed_files.length === 0) {
      return response;
    }
    return {
      ...response,
      failed_files: failed_files as unknown as ApiJsonValue,
    };
  }

  /**
   * 新建工程解析失败日志和 Toast 使用同一套逐文件原因，便于用户按日志复核。
   */
  private log_create_commit_parse_failures(
    failed_files: SourceFileParseFailureRecord[],
  ): void {
    log_source_file_parse_failures({
      failures: failed_files,
      log_manager: this.log_manager,
      source: "project-lifecycle",
      text: t_main_log,
    });
  }

  /**
   * create-commit 预过滤从后端解析草稿计算，不消费前端合成结果
   */
  private compute_create_project_prefilter_output(args: {
    draft: CreateCommitParsedDraft;
    settings: ProjectMutationSettings;
  }): ProjectPrefilterMutationOutput {
    return compute_project_prefilter_mutation({
      state: {
        files: args.draft.file_state,
        items: args.draft.items,
      },
      task_snapshot: create_empty_translation_task_snapshot(),
      source_language: args.settings.source_language,
      target_language: args.settings.target_language,
      mtool_optimizer_enable: args.settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: args.settings.skip_duplicate_source_text_enable,
    });
  }

  /**
   * 新建工程解析使用请求设置镜像，避免文件格式处理读取到过期应用语言
   */
  private create_format_service(project_settings: ProjectMutationSettings): FileFormatService {
    const config = normalize_setting_snapshot(this.app_setting_service.read_setting());
    return new FileFormatService(
      {
        source_language: project_settings.source_language,
        target_language: project_settings.target_language,
        app_language: config.app_language,
        deduplication_in_bilingual: config.deduplication_in_bilingual,
        write_translated_name_fields_to_file: config.write_translated_name_fields_to_file,
      },
      this.native_fs,
    );
  }

  /**
   * 后端解析条目必须先过公开 DTO 边界，再交给后端预过滤算法
   */
  private normalize_public_item(value: unknown): ProjectItemPublicRecord {
    const public_item = normalize_project_item_public_record(value);
    if (public_item === null) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: {
          reason: "parsed_item_incomplete",
          missing_fields: collect_project_item_missing_public_fields(value),
        },
      });
    }
    return public_item;
  }

  /**
   * 写库前统一把公开 DTO 转成持久字段，禁止调用点手写 id/row 映射
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
        section_revisions: needs_prefiltered_items
          ? this.build_project_alignment_section_revisions(meta)
          : null,
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
    const config = this.app_setting_service.read_setting();
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
    const data = JsonTool.parseStrict(this.native_fs.read_file(preset_path)) as unknown;
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
    return this.native_fs
      .read_text_file(preset_path)
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
   * 构建工程设置镜像 meta，预过滤与进度事实只取后端计算结果
   */
  private build_project_settings_meta(args: {
    project_settings: ProjectMutationSettings;
    prefilter_output: ProjectPrefilterMutationOutput;
  }): MutableJsonRecord {
    return {
      source_language: args.project_settings.source_language,
      target_language: args.project_settings.target_language,
      mtool_optimizer_enable: args.project_settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: args.project_settings.skip_duplicate_source_text_enable,
      prefilter_config: args.prefilter_output.prefilter_config as unknown as ApiJsonValue,
      translation_extras: args.prefilter_output.translation_extras as unknown as ApiJsonValue,
      analysis_extras: build_analysis_progress_snapshot({
        extras: args.prefilter_output.analysis.extras,
        status_summary: args.prefilter_output.analysis.status_summary,
      }) as unknown as ApiJsonValue,
      analysis_candidate_count: args.prefilter_output.analysis.candidate_count,
    };
  }

  /**
   * 打开前 settings alignment 只声明后端事实依赖版本，项目数据实体仍由 loaded 后的读取接口提供
   */
  private build_project_alignment_section_revisions(meta: MutableJsonRecord): MutableJsonRecord {
    return {
      files: get_runtime_section_revision(meta, "files"),
      items: get_runtime_section_revision(meta, "items"),
      analysis: get_runtime_section_revision(meta, "analysis"),
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
    return normalize_project_settings_snapshot(this.app_setting_service.read_setting());
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
    if (!this.native_fs.exists(source_path)) {
      return [];
    }
    const stats = this.native_fs.stat(source_path);
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
    const entries = this.native_fs
      .read_dirents(source_path)
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
    return this.native_fs.to_identity_path(source_path);
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
    if (!this.native_fs.exists(project_path)) {
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
