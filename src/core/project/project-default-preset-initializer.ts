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

type MutableJsonRecord = Record<string, ApiJsonValue>;

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

// QUALITY DEFAULT PRESET SPECS 是默认快照事实，调用方只读取副本不临时拼装。
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

// PROMPT DEFAULT PRESET SPECS 是默认快照事实，调用方只读取副本不临时拼装。
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

export type ProjectDefaultPresetInitializationResult = {
  operations: DatabaseOperation[];
  loaded_names: string[];
};

/**
 * 新建工程默认预设初始化器只负责读取预设文件并生成数据库操作。
 */
export class ProjectDefaultPresetInitializer {
  private readonly app_setting_service: AppSettingService; // app_setting_service 提供用户选择的默认预设虚拟 ID
  private readonly paths: AppPathService; // paths 统一解析内置 / 用户预设目录
  private readonly log_manager: LogManager; // log_manager 只记录预设加载诊断，不扩大公开响应
  private readonly native_fs: NativeFs; // native_fs 是读取预设文件的唯一磁盘入口

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
      {
        name: "setMeta",
        args: {
          projectPath: project_path,
          key: "text_preserve_mode",
          value: "smart",
        },
      },
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
          {
            name: "setRules",
            args: {
              projectPath: project_path,
              ruleType: spec.rule_type,
              rules: entries as unknown as DatabaseJsonValue,
            },
          },
          {
            name: "setMeta",
            args: {
              projectPath: project_path,
              key: spec.meta_key,
              value: spec.meta_value,
            },
          },
        );
        loaded_names.push(spec.display_name);
      } catch (error) {
        this.log_non_blocking_warning(
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
          {
            name: "setRuleText",
            args: {
              projectPath: project_path,
              ruleType: spec.rule_type,
              text: this.read_prompt_preset(spec.task_type, virtual_id),
            },
          },
          {
            name: "setMeta",
            args: {
              projectPath: project_path,
              key: spec.meta_key,
              value: true,
            },
          },
        );
        loaded_names.push(spec.display_name);
      } catch (error) {
        this.log_non_blocking_warning(
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
   * 读取提示词预设正文，统一去掉 BOM 与首尾空白。
   */
  private read_prompt_preset(task_type: "translation" | "analysis", virtual_id: string): string {
    const preset_path = this.resolve_prompt_preset_path(task_type, virtual_id);
    return this.native_fs
      .read_text_file(preset_path)
      .replace(/^\uFEFF/u, "")
      .trim();
  }

  /**
   * 解析质量规则预设虚拟 ID 到真实路径。
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
   * 解析提示词预设虚拟 ID 到真实路径。
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
      ...AppErrors.error_diagnostic_to_log_fields(AppErrors.to_error_diagnostic(error, context)),
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
}
