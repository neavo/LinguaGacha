import type { BackendServices } from "../../backend/bootstrap/backend-services";
import type { DatabaseJsonValue, DatabaseOperation } from "../../backend/database/database-types";
import { load_quality_rule_entries_from_file } from "../../backend/quality/quality-rule-file-io";
import { default_native_fs } from "../../native/native-fs";
import { Prompt } from "../../domain/prompt";
import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import type { CLICommandOptions } from "../cli-parser";

type CLIRuleResourceSpec = {
  resource_path: string | null; // resource_path 为 null 表示该规则在本次 CLI 任务中关闭
  rule_kind: QualityRuleKind;
  enabled_meta_key: string | null;
  enabled_meta_value: DatabaseJsonValue;
};

/**
 * 将 CLI 外部资源写入当前临时工程，保证 CLI 不读取 GUI 默认预设。
 */
export async function apply_cli_resources(
  backend_services: BackendServices,
  command: CLICommandOptions,
  project_path: string,
): Promise<void> {
  const operations = await build_cli_resource_operations(command, project_path);
  if (operations.length === 0) {
    return;
  }
  await backend_services.commit_cli_resource_operations(project_path, operations);
}

/**
 * 构造 CLI 资源写库操作；默认关闭所有可选规则，再按显式文件覆盖启用。
 */
async function build_cli_resource_operations(
  command: CLICommandOptions,
  project_path: string,
): Promise<DatabaseOperation[]> {
  const operations: DatabaseOperation[] = [
    ...build_disabled_quality_operations(project_path),
    ...build_disabled_prompt_operations(project_path),
  ];
  operations.push(...(await build_rule_resource_operations(project_path, command)));
  const prompt_operations = read_prompt_resource_operations(project_path, command);
  if (prompt_operations.length > 0) {
    operations.push(...prompt_operations);
  }
  operations.push(...build_revision_operations(project_path, command));
  return operations;
}

/**
 * 质量规则默认关闭，避免 CLI 临时工程继承 GUI 默认预设或文本保护 smart 模式。
 */
function build_disabled_quality_operations(project_path: string): DatabaseOperation[] {
  return [
    op("setMeta", { projectPath: project_path, key: "glossary_enable", value: false }),
    op("setMeta", {
      projectPath: project_path,
      key: "pre_translation_replacement_enable",
      value: false,
    }),
    op("setMeta", {
      projectPath: project_path,
      key: "post_translation_replacement_enable",
      value: false,
    }),
    op("setMeta", { projectPath: project_path, key: "text_preserve_mode", value: "off" }),
  ];
}

/**
 * 自定义提示词默认关闭；未传 --prompt 时仍使用内置任务模板。
 */
function build_disabled_prompt_operations(project_path: string): DatabaseOperation[] {
  return Prompt.all().map((prompt) =>
    op("setMeta", {
      projectPath: project_path,
      key: prompt.enabled_meta_key,
      value: false,
    }),
  );
}

/**
 * 翻译任务四类质量规则按外部文件启用，分析任务不会调用这些规则输入。
 */
async function build_rule_resource_operations(
  project_path: string,
  command: CLICommandOptions,
): Promise<DatabaseOperation[]> {
  const operations: DatabaseOperation[] = [];
  if (command.command !== "translate") {
    return operations;
  }
  for (const spec of build_rule_resource_specs(command)) {
    if (spec.resource_path === null) {
      continue;
    }
    const rule = QualityRule.from_json(spec.rule_kind);
    const entries = await load_quality_rule_entries_from_file(spec.resource_path);
    operations.push(
      op("setRules", {
        projectPath: project_path,
        ruleType: rule.database_type,
        rules: entries as unknown as DatabaseJsonValue,
      }),
    );
    if (spec.enabled_meta_key !== null) {
      operations.push(
        op("setMeta", {
          projectPath: project_path,
          key: spec.enabled_meta_key,
          value: spec.enabled_meta_value,
        }),
      );
    }
  }
  return operations;
}

/**
 * 规则参数与工程 meta 的对应关系集中在这里，避免 CLI job 散落物理 key。
 */
function build_rule_resource_specs(command: CLICommandOptions): CLIRuleResourceSpec[] {
  return [
    {
      resource_path: command.resources.glossaryPath,
      rule_kind: "glossary",
      enabled_meta_key: "glossary_enable",
      enabled_meta_value: true,
    },
    {
      resource_path: command.resources.preReplacementPath,
      rule_kind: "pre_replacement",
      enabled_meta_key: "pre_translation_replacement_enable",
      enabled_meta_value: true,
    },
    {
      resource_path: command.resources.postReplacementPath,
      rule_kind: "post_replacement",
      enabled_meta_key: "post_translation_replacement_enable",
      enabled_meta_value: true,
    },
    {
      resource_path: command.resources.textPreservePath,
      rule_kind: "text_preserve",
      enabled_meta_key: "text_preserve_mode",
      enabled_meta_value: "custom",
    },
  ];
}

/**
 * --prompt 根据命令类型写入对应提示词槽位，翻译和分析不共享同一个物理规则。
 */
function read_prompt_resource_operations(
  project_path: string,
  command: CLICommandOptions,
): DatabaseOperation[] {
  if (command.resources.promptPath === null) {
    return [];
  }
  const prompt = command.command === "translate" ? Prompt.translation() : Prompt.analysis();
  const text = default_native_fs
    .read_text_file(command.resources.promptPath)
    .replace(/^\uFEFF/u, "")
    .trim();
  return [
    op("setRuleText", {
      projectPath: project_path,
      ruleType: prompt.database_type,
      text,
    }),
    op("setMeta", {
      projectPath: project_path,
      key: prompt.enabled_meta_key,
      value: true,
    }),
  ];
}

/**
 * CLI 资源直接改写临时工程事实，需要推进质量和提示词 revision 供任务启动校验读取。
 */
function build_revision_operations(
  project_path: string,
  command: CLICommandOptions,
): DatabaseOperation[] {
  const quality_revisions = QualityRule.all().map((rule) =>
    op("setMeta", {
      projectPath: project_path,
      key: rule.revision_meta_key,
      value: 1,
    }),
  );
  const prompt_revisions =
    command.resources.promptPath === null
      ? []
      : [
          op("setMeta", {
            projectPath: project_path,
            key:
              command.command === "translate"
                ? Prompt.translation().revision_meta_key
                : Prompt.analysis().revision_meta_key,
            value: 1,
          }),
        ];
  return [...quality_revisions, ...prompt_revisions];
}

/**
 * 创建 database workflow 操作，保持 CLI 资源写入仍走 ProjectDatabase 窄协议。
 */
function op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
  return { name, args };
}
