import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  QualityRuleEntryByType,
  QualityRuleType,
  QualityRuleQueryResponse,
  QualityRuleQuerySlice,
  QualityRulePresets,
  QualityRulePresetChange,
  QualityRuleUpdateRequest,
} from "@shared/quality/quality-rule-api";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
export type { QualityRuleType, QualityRuleQuerySlice };

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

/** 规则写入沿用工程提交回执；调用者必须通过工程写入口执行。 */
export function update_quality_rule<K extends QualityRuleType>(
  request: QualityRuleUpdateRequest<K>,
): Promise<ProjectWriteResultPayload> {
  return api_fetch("/api/quality/rules/update", request);
}
/** 读取预设目录快照，默认标记由设置快照提供。 */
export function read_quality_rule_presets(rule_type: QualityRuleType): Promise<QualityRulePresets> {
  return api_fetch("/api/quality/rules/presets", { rule_type });
}
/** 读取预设条目，应用和重复确认由编辑流程负责。 */
export async function read_quality_rule_preset<K extends QualityRuleType>(
  rule_type: K,
  virtual_id: string,
): Promise<QualityRuleEntryByType[K][]> {
  const response = await api_fetch<{ entries: QualityRuleEntryByType[K][] }>(
    "/api/quality/rules/presets/read",
    { rule_type, virtual_id },
  );
  return response.entries;
}
/** 保存当前规则为用户预设。 */
export function save_quality_rule_preset<K extends QualityRuleType>(
  rule_type: K,
  name: string,
  entries: QualityRuleEntryByType[K][],
): Promise<unknown> {
  return api_fetch("/api/quality/rules/presets/save", { rule_type, name, entries });
}
/** 用一个后端命令更新名称和关联的默认引用。 */
export function rename_quality_rule_preset(
  rule_type: QualityRuleType,
  virtual_id: string,
  new_name: string,
): Promise<QualityRulePresetChange> {
  return api_fetch("/api/quality/rules/presets/rename", { rule_type, virtual_id, new_name });
}
/** 等待文件与默认引用的删除命令完成。 */
export function delete_quality_rule_preset(
  rule_type: QualityRuleType,
  virtual_id: string,
): Promise<QualityRulePresetChange> {
  return api_fetch("/api/quality/rules/presets/delete", { rule_type, virtual_id });
}
/** 通过应用设置入口保存默认预设引用。 */
export function update_quality_rule_default_preset(
  key: string,
  value: string,
): Promise<SettingsSnapshotPayload> {
  return api_fetch("/api/settings/update", { [key]: value });
}
