import { read_json_record, type JsonValue } from "../../domain/json";

/**
 * 在事务当前可见的完整集合中按文件原位替换 Item，保留其它文件的顺序与最新内容。
 */
export function replace_project_file_items(
  current_items: JsonValue[],
  replacements: ReadonlyMap<string, JsonValue[]>,
): JsonValue[] {
  const emitted_paths = new Set<string>();
  const next_items: JsonValue[] = [];
  for (const item of current_items) {
    const file_path = read_json_record(item)["file_path"];
    if (typeof file_path !== "string") {
      next_items.push(item);
      continue;
    }
    const replacement = replacements.get(file_path);
    if (replacement === undefined) {
      next_items.push(item);
      continue;
    }
    if (!emitted_paths.has(file_path)) {
      next_items.push(...replacement);
      emitted_paths.add(file_path);
    }
  }
  return next_items;
}
