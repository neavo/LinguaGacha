import type { ProjectChangeItemFieldPatch } from "../project-event";

// 统计失效范围只表达文本源影响，调用方再映射成具体规则集合。
export type QualityStatisticsTextChangeScope = "none" | "post_replacement" | "all";

// 这些写入来源由任务链路保证只提交译文字段。
const QUALITY_STATISTICS_TRANSLATION_ITEM_SOURCES = new Set([
  "translation_batch_update",
  "retranslate_items",
]);
// 状态和译名不属于当前规则统计的文本源；译后替换只扫描正文 dst。
const QUALITY_STATISTICS_IGNORED_FIELDS = new Set<keyof ProjectChangeItemFieldPatch>([
  "status",
  "retry_count",
  "name_dst",
]);

/**
 * 按 item 变更 payload 判定质量统计文本源影响范围，证据不足时扩大到全量。
 */
export function resolve_quality_statistics_item_text_change_scope(args: {
  source: string;
  fullReplace: boolean;
  deleteCount: number;
  fieldPatch?: ProjectChangeItemFieldPatch | null;
}): QualityStatisticsTextChangeScope {
  if (args.fullReplace || args.deleteCount > 0) {
    return "all";
  }
  if (QUALITY_STATISTICS_TRANSLATION_ITEM_SOURCES.has(args.source)) {
    return "post_replacement";
  }
  if (args.fieldPatch == null) {
    return "all";
  }

  return resolve_quality_statistics_field_patch_scope(args.fieldPatch);
}

/**
 * 字段补丁是精确缩小失效范围的证据，任何未知字段都按全量风险处理。
 */
function resolve_quality_statistics_field_patch_scope(
  field_patch: ProjectChangeItemFieldPatch,
): QualityStatisticsTextChangeScope {
  const fields = Object.keys(field_patch) as Array<keyof ProjectChangeItemFieldPatch>;
  if (fields.length === 0) {
    return "all";
  }
  if (fields.every((field) => QUALITY_STATISTICS_IGNORED_FIELDS.has(field))) return "none";
  return fields.every((field) => field === "dst" || QUALITY_STATISTICS_IGNORED_FIELDS.has(field))
    ? "post_replacement"
    : "all";
}
