import path from "node:path";

import { resolve_preset_file, type AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { LogWriter } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import type { NativeFs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import { JsonTool } from "../../shared/utils/json-tool";
import { TRANSLATION_PROMPT } from "../../domain/prompt";
import { QualityRule, type QualityRuleEntry } from "../../domain/quality";
import { create_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import type {
  ProjectPromptInput,
  ProjectQualityRuleInput,
  ProjectTaskInput,
} from "./project-task-input";
import { build_project_quality_rule_input } from "./project-task-input";

/** 将应用设置选中的默认预设读成新建工程的规则和提示词。 */
export class ProjectDefaultPresetReader {
  /** 预设目录由应用路径服务统一定位。 */
  public constructor(
    private readonly app_setting_service: Pick<AppSettingService, "read_setting">,
    private readonly paths: AppPathService,
    private readonly native_fs: NativeFs,
  ) {}

  /**
   * 读取新建工程默认预设，单个预设失败只记录日志并继续创建。
   */
  public read(log: Pick<LogWriter, "warning">): ProjectTaskInput {
    const config = this.app_setting_service.read_setting();
    const quality_rules: ProjectQualityRuleInput[] = [];
    let translation_prompt: ProjectPromptInput | null = null;

    // 质量规则从领域模型派生目录与设置 key，输出只保留公开 kind 和领域值。
    for (const rule of QualityRule.all()) {
      const virtual_id = String(config[rule.default_preset_setting_key] ?? "");
      if (virtual_id === "") {
        continue;
      }
      try {
        const entries = this.read_quality_rule_preset(rule, virtual_id);
        quality_rules.push(build_project_quality_rule_input(rule, entries, true));
      } catch (error) {
        log.warning(t_main_log("app.diagnostic.default_preset.quality_rule_load_failed"), {
          source: "project-lifecycle",
          error,
          context: { preset_directory: rule.preset_directory, virtual_id },
        });
      }
    }

    const prompt_id = String(config[TRANSLATION_PROMPT.default_preset_setting_key] ?? "");
    if (prompt_id !== "") {
      try {
        translation_prompt = { text: this.read_prompt_preset(prompt_id), enabled: true };
      } catch (error) {
        log.warning(t_main_log("app.diagnostic.default_preset.prompt_load_failed"), {
          source: "project-lifecycle",
          error,
          context: { prompt_kind: TRANSLATION_PROMPT.store_key, virtual_id: prompt_id },
        });
      }
    }
    return { quality_rules, translation_prompt };
  }

  /** 任一条目无效时，由调用方记录告警并跳过整份预设。 */
  private read_quality_rule_preset(rule: QualityRule, virtual_id: string): QualityRuleEntry[] {
    const { file_path: preset_path } = resolve_preset_file(
      {
        virtual_id,
        extension: rule.preset_extension,
        builtin_directory: this.paths.get_quality_rule_builtin_preset_dir(rule.preset_directory),
        user_directory: this.paths.get_quality_rule_user_preset_dir(rule.preset_directory),
        allow_legacy_namespace: true,
      },
      this.native_fs,
    );
    const data = JsonTool.parseStrict(this.native_fs.read_file(preset_path)) as unknown;
    if (!Array.isArray(data)) {
      throw new AppErrors.AppError("request.validation_failed", {
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
  private read_prompt_preset(virtual_id: string): string {
    const { file_path } = resolve_preset_file(
      {
        virtual_id,
        extension: TRANSLATION_PROMPT.preset_extension,
        builtin_directory: this.paths.get_prompt_builtin_preset_dir(),
        user_directory: this.paths.get_prompt_user_preset_dir(),
      },
      this.native_fs,
    );
    return this.native_fs.read_text_file(file_path).trim();
  }
}
