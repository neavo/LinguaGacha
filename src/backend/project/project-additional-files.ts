import assert from "node:assert/strict";
import { is_json_record, type JsonRecord } from "../../domain/json";

/** 清单是导入时的资产事实。旧工程缺省为空，损坏的清单不能退回解析全部成员。 */
export function read_project_additional_files(meta: JsonRecord): Record<string, string[]> {
  const value = meta["additional_files"];
  if (value === undefined) return {};
  assert(is_json_record(value), "Invalid project additional_files");
  return Object.fromEntries(
    Object.entries(value).map(([file, names]) => {
      assert(
        Array.isArray(names) && names.every((name) => typeof name === "string"),
        "Invalid project additional_files: " + file,
      );
      return [file, [...names]];
    }),
  );
}
