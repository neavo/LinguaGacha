import type {
  ProjectPromptInput,
  ProjectTaskInput,
} from "../../backend/project/project-task-input";
import { build_project_quality_rule_input } from "../../backend/project/project-task-input";
import { load_quality_rule_entries_from_file } from "../../backend/quality/quality-rule-file-io";

import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import { create_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import { default_native_fs } from "../../native/native-fs";
import type { CLICommandOptions } from "../cli-parser";

/**
 * 将 CLI 外部资源解析成项目领域输入；CLI 不接触数据库、meta key 或 revision。
 */
export async function build_cli_task_input(command: CLICommandOptions): Promise<ProjectTaskInput> {
  return {
    quality_rules: await Promise.all(
      QualityRule.all().map(async (rule) => {
        const resource_path = read_rule_resource_path(command, rule.kind);
        const entries = create_quality_rule_entries(
          rule,
          resource_path === null ? [] : await load_quality_rule_entries_from_file(resource_path),
        );
        return build_project_quality_rule_input(rule, entries, resource_path !== null);
      }),
    ),
    translation_prompt: build_prompt_input(command),
  };
}

/**
 * 翻译任务按规则 kind 读取对应命令参数。
 */
function read_rule_resource_path(command: CLICommandOptions, kind: QualityRuleKind): string | null {
  const resources: Record<QualityRuleKind, string | null> = {
    glossary: command.resources.glossaryPath,
    text_preserve: command.resources.textPreservePath,
    pre_replacement: command.resources.preReplacementPath,
    post_replacement: command.resources.postReplacementPath,
  };
  return resources[kind];
}

/**
 * 只启用当前任务类型且显式传入的自定义提示词。
 */
function build_prompt_input(command: CLICommandOptions): ProjectPromptInput {
  const enabled = command.resources.promptPath !== null;
  return {
    text: enabled ? read_prompt_text(command.resources.promptPath) : "",
    enabled,
  };
}

/**
 * 提示词文件统一去掉 BOM 与首尾空白。
 */
function read_prompt_text(file_path: string | null): string {
  return file_path === null
    ? ""
    : default_native_fs
        .read_text_file(file_path)
        .replace(/^\uFEFF/u, "")
        .trim();
}
