import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  GlossaryEntry,
  QualityRuleKind,
  TextPreserveEntry,
  TextReplacementEntry,
} from "@domain/quality";

type QualityRuleSectionRevisions = Record<string, number | undefined>;
export type QualityRuleType = QualityRuleKind;

type QualityRuleEntryByType = {
  glossary: GlossaryEntry;
  pre_replacement: TextReplacementEntry;
  post_replacement: TextReplacementEntry;
  text_preserve: TextPreserveEntry;
};

export type QualityRuleQuerySlice<TType extends QualityRuleType = QualityRuleType> = {
  enabled?: unknown;
  mode?: unknown;
  entries?: QualityRuleEntryByType[TType][];
};

type QualityRuleQueryResponse<TType extends QualityRuleType = QualityRuleType> = {
  projectPath: string;
  sectionRevisions?: QualityRuleSectionRevisions;
  qualityRule?: QualityRuleQuerySlice<TType>;
};

/**
 * 通过统一质量规则查询入口读取指定规则切片，页面负责在边界处窄化载荷。
 */
export async function read_quality_rule_snapshot<TType extends QualityRuleType>(
  rule_type: TType,
): Promise<QualityRuleQueryResponse<TType>> {
  return await api_fetch<QualityRuleQueryResponse<TType>>("/api/quality/rules/query", {
    rule_type,
  });
}

/** 从统一导入入口读取指定规则类型，空或坏 entries 载荷按无有效数据处理。 */
export async function import_quality_rule_entries<TType extends QualityRuleType>(
  rule_type: TType,
  path: string,
): Promise<QualityRuleEntryByType[TType][]> {
  const payload = await api_fetch<{ entries?: QualityRuleEntryByType[TType][] }>(
    "/api/quality/rules/import",
    { rule_type, path },
  );
  return Array.isArray(payload.entries) ? payload.entries : [];
}

/** 使用质量规则页共用的系统文件选择器读取导入路径。 */
export async function pick_quality_rule_import_path(): Promise<string | null> {
  const result = await window.desktopApp.pickGlossaryImportFilePath();
  return result.canceled ? null : (result.paths[0] ?? null);
}

/** 选择导出路径并提交当前页面规则；取消选择不视为导出成功。 */
export async function export_quality_rule_entries<TType extends QualityRuleType>(args: {
  rule_type: TType;
  file_name: string;
  entries: QualityRuleEntryByType[TType][];
}): Promise<boolean> {
  const result = await window.desktopApp.pickGlossaryExportPath(args.file_name);
  const path = result.canceled ? null : (result.paths[0] ?? null);
  if (path === null) {
    return false;
  }

  await api_fetch("/api/quality/rules/export", {
    rule_type: args.rule_type,
    path,
    entries: args.entries,
  });
  return true;
}
