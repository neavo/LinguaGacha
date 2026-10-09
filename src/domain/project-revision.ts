import { Type } from "typebox";
import { read_json_integer } from "./json";

export const PROJECT_REVISION_SCHEMA = Type.Integer({ minimum: 0 });

/** 历史项目修订允许数值转换与截断，请求中的预期修订由写入边界严格校验。 */
export function read_project_revision(value: unknown): number {
  return Math.max(0, read_json_integer(value, 0));
}
