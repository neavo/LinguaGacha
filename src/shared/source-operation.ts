/** 来源操作已经发生的成果与副作用。成功或失败由正常返回与 `AppError` 表达。 */
export type SourceOperationResult = Readonly<{
  saved_assets: number; // 只取提交确认后的实际保存数量，已提交后失败也保留。
  directory_changes: readonly string[];
}>;

/** CLI 从动态回执读取操作事实，拒绝无效统计并隔离目录数组。 */
export function read_source_operation_result(value: unknown): SourceOperationResult | undefined {
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.saved_assets !== "number" ||
    !Number.isSafeInteger(record.saved_assets) ||
    record.saved_assets < 0 ||
    !Array.isArray(record.directory_changes) ||
    !record.directory_changes.every((path) => typeof path === "string")
  )
    return;
  return {
    saved_assets: record.saved_assets,
    directory_changes: [...record.directory_changes],
  };
}
