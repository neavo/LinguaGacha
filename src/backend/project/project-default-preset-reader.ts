import path from "node:path";

import { resolve_preset_file, type AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import { NativeFs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import type { JsonValue } from "../../domain/json";
import { JsonTool } from "../../shared/utils/json-tool";
import { Prompt, type PromptKind } from "../../domain/prompt";
import {
  QualityRule,
  type QualityRuleEntry,
  type QualityRuleKind,
  type TextPreserveMode,
} from "../../domain/quality";
import { create_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import type {
  ProjectPromptInput,
  ProjectQualityRuleInput,
  ProjectTaskInput,
} from "./project-task-input";
import { build_project_quality_rule_input } from "./project-task-input";

// 文本保护默认 mode 的权威在质量规则领域模型，初始化器只消费该项目事实默认值。
const DEFAULT_TEXT_PRESERVE_MODE = QualityRule.from_json("text_preserve").default_mode;
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
 * 默认预设读取结果是显式项目输入，不携带数据库写闭包。
 */
export type ProjectDefaultPresetInput = ProjectTaskInput & {
  text_preserve_mode: TextPreserveMode;
  loaded_names: string[];
};

/**
 * 新建工程默认预设读取器只负责解析文件，数据库写入仍由项目生命周期拥有。
 */
export class ProjectDefaultPresetReader {
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
   * 读取新建工程默认预设，单个预设失败只记录日志并继续创建。
   */
  public read(): ProjectDefaultPresetInput {
    const config = this.app_setting_service.read_setting();
    const quality_rules: ProjectQualityRuleInput[] = [];
    const prompts: ProjectPromptInput[] = [];
    const loaded_names: string[] = [];

    // 质量规则从领域模型派生目录与设置 key，输出只保留公开 kind 和领域值。
    for (const rule of QualityRule.all()) {
      const virtual_id = this.string_value(config[rule.default_preset_setting_key]);
      if (virtual_id === "") {
        continue;
      }
      try {
        const entries = this.read_quality_rule_preset(rule, virtual_id);
        quality_rules.push(build_project_quality_rule_input(rule, entries, true));
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
        prompts.push(this.build_prompt_input(prompt, text));
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

    return {
      text_preserve_mode: DEFAULT_TEXT_PRESERVE_MODE,
      quality_rules,
      prompts,
      loaded_names,
    };
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

  /** 读取质量规则预设；任一非法条目由调用方现有 warning/skip 分支整体跳过。 */
  private read_quality_rule_preset(rule: QualityRule, virtual_id: string): QualityRuleEntry[] {
    const preset_path = this.resolve_quality_rule_preset_path(rule, virtual_id);
    const data = JsonTool.parseStrict(this.native_fs.read_file(preset_path)) as unknown;
    if (!Array.isArray(data)) {
      throw new AppErrors.RequestValidationError({
        public_details: {
          filename: path.basename(preset_path),
        },
      });
    }
    return create_quality_rule_entries(rule, data);
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
    return resolve_preset_file({
      virtual_id,
      extension: rule.preset_extension,
      builtin_directory: this.paths.get_quality_rule_builtin_preset_dir(rule.preset_directory),
      user_directory: this.paths.get_quality_rule_user_preset_dir(rule.preset_directory),
      allow_legacy_namespace: true,
    }).file_path;
  }

  /**
   * 解析提示词预设虚拟 ID 到真实路径。
   */
  private resolve_prompt_preset_path(prompt: Prompt, virtual_id: string): string {
    return resolve_preset_file({
      virtual_id,
      extension: prompt.preset_extension,
      builtin_directory: this.paths.get_prompt_builtin_preset_dir(prompt.kind),
      user_directory: this.paths.get_prompt_user_preset_dir(prompt.kind),
    }).file_path;
  }

  /**
   * 将提示词模型收窄为生命周期可直接写入的显式输入。
   */
  private build_prompt_input(prompt: Prompt, text: string): ProjectPromptInput {
    return {
      kind: prompt.kind,
      text,
      enabled: true,
    };
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
   * 从未知值读取字符串，保持 null / undefined 统一为空串。
   */
  private string_value(value: JsonValue | undefined): string {
    return typeof value === "string" ? value : String(value ?? "");
  }
}
