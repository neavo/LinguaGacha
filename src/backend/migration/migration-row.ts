/**
 * node:sqlite 行值在不同运行时可能包含 string、number 或 bigint。
 */
export type MigrationRow = Record<string, unknown>;

/**
 * SQLite 文本列统一收窄为字符串，缺失值按空文本参与迁移判断。
 */
export function row_text(row: MigrationRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * SQLite INTEGER 写回前统一转 number，兼容 bigint 返回。
 */
export function row_number(row: MigrationRow, key: string): number {
  const value = row[key];
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}
