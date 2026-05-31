import path from "node:path";

import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import { NativeFs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import type { ApiJsonValue } from "../api/api-types";
import { JsonTool } from "../../shared/utils/json-tool";
import { Prompt, type PromptKind } from "../../domain/prompt";
import { QualityRule, type QualityRuleKind, type TextPreserveMode } from "../../domain/quality";

type MutableJsonRecord = Record<string, ApiJsonValue>;

// 默认预设写入的是新建工程的初始事实，revision 从首个可查询版本开始。
const INITIAL_PRESET_REVISION = 1;
// 文本保护默认 mode 的权威在质量规则领域模型，初始化器只消费该项目事实默认值。
const DEFAULT_TEXT_PRESERVE_MODE = QualityRule.from_json("text_preserve").default_mode;
// 文本保护默认预设成功加载后，项目事实切换为用户可见的 custom 模式。
const LOADED_TEXT_PRESERVE_PRESET_MODE = "custom" satisfies TextPreserveMode;

// 领域模型不承载日志展示名，初始化器只保留这层面向日志的映射。
const QUALITY_DEFAULT_PRESET_DISPLAY_NAMES: Record<QualityRuleKind, string> = {
  glossary: "术语表",
  text_preserve: "文本保护",
  pre_replacement: "译前替换",
  post_replacement: "译后替换",
};

// 提示词日志名独立于数据库物理类型，避免日志文案反向污染领域模型。
const PROMPT_DEFAULT_PRESET_DISPLAY_NAMES: Record<PromptKind, string> = {
  translation: "翻译提示词",
  analysis: "分析提示词",
};

/**
 * 初始化结果同时返回数据库操作和成功加载名，调用方据此决定事务写入与日志输出。
 */
export type ProjectDefaultPresetInitializationResult = {
  operations: DatabaseOperation[];
  loaded_names: string[];
};

/**
 * 新建工程默认预设初始化器只负责读取预设文件并生成数据库操作。
 */
export class ProjectDefaultPresetInitializer {
  private readonly app_setting_service: AppSettingService; // 提供用户选择的默认预设虚拟 ID
  private readonly paths: AppPathService; // 统一解析内置 / 用户预设目录
  private readonly log_manager: LogManager; // 只记录预设加载诊断，不扩大公开响应
  private readonly native_fs: NativeFs; // 读取预设文件的唯一磁盘入口

  /**
   * 构造时固定路径、设置和日志依赖，保持生命周期服务只负责装配。
   */
  public constructor(
    app_setting_service: AppSettingService,
    paths: AppPathService,
    log_manager: LogManager,
    native_fs: NativeFs,
  ) {
    this.app_setting_service = app_setting_service;
    this.paths = paths;
    this.log_manager = log_manager;
    this.native_fs = native_fs;
  }

  /**
   * 构建新建工程默认预设初始化操作，单个预设失败只记录日志并继续创建。
   */
  public build_operations(project_path: string): ProjectDefaultPresetInitializationResult {
    const config = this.app_setting_service.read_setting();
    const operations: DatabaseOperation[] = [
      // 文本保护 mode 是项目设置事实，即使没有默认预设也要进入创建事务。
      {
        name: "setMeta",
        args: {
          projectPath: project_path,
          key: "text_preserve_mode",
          value: DEFAULT_TEXT_PRESERVE_MODE,
        },
      },
    ];
    const loaded_names: string[] = [];

    // 质量规则从领域模型派生目录、设置 key、物理类型和 revision key，避免第二套词表。
    for (const rule of QualityRule.all()) {
      const virtual_id = this.string_value(config[rule.default_preset_setting_key]);
      if (virtual_id === "") {
        continue;
      }
      try {
        const entries = this.read_quality_rule_preset(rule, virtual_id);
        operations.push(...this.build_quality_rule_operations(project_path, rule, entries));
        loaded_names.push(QUALITY_DEFAULT_PRESET_DISPLAY_NAMES[rule.kind]);
      } catch (error) {
        this.log_non_blocking_warning(
          t_main_log("app.diagnostic.default_preset.quality_rule_load_failed"),
          error,
          {
            preset_directory: rule.preset_directory,
            virtual_id,
          },
        );
      }
    }

    // 提示词默认预设与质量规则走同一容错策略，单项失败不阻断工程创建。
    for (const prompt of Prompt.all()) {
      const virtual_id = this.string_value(config[prompt.default_preset_setting_key]);
      if (virtual_id === "") {
        continue;
      }
      try {
        const text = this.read_prompt_preset(prompt, virtual_id);
        operations.push(...this.build_prompt_operations(project_path, prompt, text));
        loaded_names.push(PROMPT_DEFAULT_PRESET_DISPLAY_NAMES[prompt.kind]);
      } catch (error) {
        this.log_non_blocking_warning(
          t_main_log("app.diagnostic.default_preset.prompt_load_failed"),
          error,
          {
            task_type: prompt.kind,
            virtual_id,
          },
        );
      }
    }

    return { operations, loaded_names };
  }

  /**
   * 记录成功加载的默认预设名；为空时不写日志，避免制造噪声。
   */
  public log_loaded_names(loaded_names: string[]): void {
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
   * 读取质量规则预设，并把非对象条目过滤掉。
   */
  private read_quality_rule_preset(rule: QualityRule, virtual_id: string): MutableJsonRecord[] {
    const preset_path = this.resolve_quality_rule_preset_path(rule, virtual_id);
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
   * 读取提示词预设正文，统一去掉 BOM 与首尾空白。
   */
  private read_prompt_preset(prompt: Prompt, virtual_id: string): string {
    const preset_path = this.resolve_prompt_preset_path(prompt, virtual_id);
    return this.native_fs
      .read_text_file(preset_path)
      .replace(/^\uFEFF/u, "")
      .trim();
  }

  /**
   * 解析质量规则预设虚拟 ID 到真实路径。
   */
  private resolve_quality_rule_preset_path(rule: QualityRule, virtual_id: string): string {
    const { source, file_name } = this.split_virtual_id(virtual_id, rule.preset_extension);
    const directory =
      source === "builtin"
        ? this.paths.get_quality_rule_builtin_preset_dir(rule.preset_directory)
        : this.paths.get_quality_rule_user_preset_dir(rule.preset_directory);
    return path.join(directory, file_name);
  }

  /**
   * 解析提示词预设虚拟 ID 到真实路径。
   */
  private resolve_prompt_preset_path(prompt: Prompt, virtual_id: string): string {
    const { source, file_name } = this.split_virtual_id(virtual_id, prompt.preset_extension);
    const directory =
      source === "builtin"
        ? this.paths.get_prompt_builtin_preset_dir(prompt.kind)
        : this.paths.get_prompt_user_preset_dir(prompt.kind);
    return path.join(directory, file_name);
  }

  /**
   * 默认预设成功写入内容后同步写入启用态和 query 依赖的 section revision。
   */
  private build_quality_rule_operations(
    project_path: string,
    rule: QualityRule,
    entries: MutableJsonRecord[],
  ): DatabaseOperation[] {
    const operations: DatabaseOperation[] = [
      this.op("setRules", {
        projectPath: project_path,
        ruleType: rule.database_type,
        rules: entries as unknown as DatabaseJsonValue,
      }),
    ];
    if (rule.enabled_meta_key !== null) {
      operations.push(
        this.op("setMeta", {
          projectPath: project_path,
          key: rule.enabled_meta_key,
          value: true,
        }),
      );
    }
    if (rule.mode_meta_key !== null) {
      operations.push(
        this.op("setMeta", {
          projectPath: project_path,
          key: rule.mode_meta_key,
          value: LOADED_TEXT_PRESERVE_PRESET_MODE,
        }),
      );
    }
    operations.push(
      this.op("setMeta", {
        projectPath: project_path,
        key: rule.revision_meta_key,
        value: INITIAL_PRESET_REVISION,
      }),
    );
    return operations;
  }

  /**
   * 默认提示词成功写入正文后同步写入启用态和 query 依赖的 section revision。
   */
  private build_prompt_operations(
    project_path: string,
    prompt: Prompt,
    text: string,
  ): DatabaseOperation[] {
    return [
      this.op("setRuleText", {
        projectPath: project_path,
        ruleType: prompt.database_type,
        text,
      }),
      this.op("setMeta", {
        projectPath: project_path,
        key: prompt.enabled_meta_key,
        value: true,
      }),
      this.op("setMeta", {
        projectPath: project_path,
        key: prompt.revision_meta_key,
        value: INITIAL_PRESET_REVISION,
      }),
    ];
  }

  /**
   * 拆分虚拟 ID，集中保护 preset 文件名不能逃逸目录。
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
   * 校验预设文件名，避免用户配置值被解释成任意文件路径。
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
   * 记录不阻断当前主流程的预设加载错误，保留上下文供日志窗口排查。
   */
  private log_non_blocking_warning(
    message: string,
    error: unknown,
    context: Record<string, unknown>,
  ): void {
    this.log_manager.warning(message, {
      source: "project-lifecycle",
      error,
      context,
    });
  }

  /**
   * 收窄未知 JSON 对象，保护数组和 null 不被当作 record。
   */
  private is_record(value: unknown): value is MutableJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 从未知值读取字符串，保持 null / undefined 统一为空串。
   */
  private string_value(value: ApiJsonValue | DatabaseJsonValue | undefined): string {
    return typeof value === "string" ? value : String(value ?? "");
  }

  /**
   * 创建 database workflow operation，统一限制初始化器可写入的 JSON 参数形状。
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
