import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  QualityRuleQueryResponse,
  QualityRulePresets,
  QualityRulePresetChange,
  QualityRuleUpdateRequest,
  QualityRuleEntriesResponse,
  QualityRuleExportResponse,
  QualityRulePresetSaveResponse,
  QualityRuleQueryRequest,
  QualityRuleFileRequest,
  QualityRulePresetRequest,
  QualityRulePresetRenameRequest,
  QualityRulePresetSaveRequest,
  QualityRuleExportRequest,
} from "@shared/quality/quality-rule-api";
import type { QualityRuleEntryByKind, QualityRuleKind } from "@domain/quality";
import type { ProjectWriteResult } from "@shared/project-event";
import type { SettingsUpdateResponse } from "@shared/settings";

/**
 * 读取后端完整规则切片，供页面映射交互状态。
 */
export async function read_quality_rule_snapshot<TType extends QualityRuleKind>(
  rule_type: TType,
): Promise<QualityRuleQueryResponse<TType>> {
  return await api_fetch<QualityRuleQueryResponse<TType>>("/api/quality/rules/query", {
    rule_type,
  } satisfies QualityRuleQueryRequest);
}

/** 导入入口负责条目校验与身份分配，客户端直接消费完整结果。 */
export async function import_quality_rule_entries<TType extends QualityRuleKind>(
  rule_type: TType,
  path: string,
): Promise<QualityRuleEntryByKind[TType][]> {
  const payload = await api_fetch<QualityRuleEntriesResponse<TType>>("/api/quality/rules/import", {
    rule_type,
    path,
  } satisfies QualityRuleFileRequest);
  return payload.entries;
}

/** 使用质量规则页共用的系统文件选择器读取导入路径。 */
export async function pick_quality_rule_import_path(): Promise<string | null> {
  const result = await window.desktopApp.pickGlossaryImportFilePath();
  return result.canceled ? null : (result.paths[0] ?? null);
}

/** 选择导出路径并提交当前页面规则；取消选择不视为导出成功。 */
export async function export_quality_rule_entries<TType extends QualityRuleKind>(args: {
  rule_type: TType;
  file_name: string;
  entries: QualityRuleEntryByKind[TType][];
}): Promise<boolean> {
  const result = await window.desktopApp.pickGlossaryExportPath(args.file_name);
  const path = result.canceled ? null : (result.paths[0] ?? null);
  if (path === null) {
    return false;
  }

  await api_fetch<QualityRuleExportResponse>("/api/quality/rules/export", {
    rule_type: args.rule_type,
    path,
    entries: args.entries,
  } satisfies QualityRuleExportRequest<TType>);
  return true;
}

/** 规则写入沿用工程提交回执；调用者必须通过工程写入口执行。 */
export function update_quality_rule<K extends QualityRuleKind>(
  request: QualityRuleUpdateRequest<K>,
): Promise<ProjectWriteResult> {
  return api_fetch("/api/quality/rules/update", request);
}
/** 读取预设目录快照，默认标记由设置快照提供。 */
export function read_quality_rule_presets(rule_type: QualityRuleKind): Promise<QualityRulePresets> {
  return api_fetch("/api/quality/rules/presets", { rule_type } satisfies QualityRuleQueryRequest);
}
/** 读取预设条目，应用和重复确认由编辑流程负责。 */
export async function read_quality_rule_preset<K extends QualityRuleKind>(
  rule_type: K,
  virtual_id: string,
): Promise<QualityRuleEntryByKind[K][]> {
  const response = await api_fetch<QualityRuleEntriesResponse<K>>(
    "/api/quality/rules/presets/read",
    { rule_type, virtual_id } satisfies QualityRulePresetRequest,
  );
  return response.entries;
}
/** 保存当前规则为用户预设。 */
export function save_quality_rule_preset<K extends QualityRuleKind>(
  rule_type: K,
  name: string,
  entries: QualityRuleEntryByKind[K][],
): Promise<QualityRulePresetSaveResponse> {
  return api_fetch("/api/quality/rules/presets/save", {
    rule_type,
    name,
    entries,
  } satisfies QualityRulePresetSaveRequest<K>);
}
/** 用一个后端命令更新名称和关联的默认引用。 */
export function rename_quality_rule_preset(
  rule_type: QualityRuleKind,
  virtual_id: string,
  new_name: string,
): Promise<QualityRulePresetChange> {
  return api_fetch("/api/quality/rules/presets/rename", {
    rule_type,
    virtual_id,
    new_name,
  } satisfies QualityRulePresetRenameRequest);
}
/** 等待文件与默认引用的删除命令完成。 */
export function delete_quality_rule_preset(
  rule_type: QualityRuleKind,
  virtual_id: string,
): Promise<QualityRulePresetChange> {
  return api_fetch("/api/quality/rules/presets/delete", {
    rule_type,
    virtual_id,
  } satisfies QualityRulePresetRequest);
}
/** 通过应用设置入口保存默认预设引用。 */
export function update_quality_rule_default_preset(
  key: string,
  value: string,
): Promise<SettingsUpdateResponse> {
  return api_fetch("/api/settings/update", { [key]: value });
}
