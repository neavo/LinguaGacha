import { is_json_record } from "@domain/json";

const SKILL_DOCUMENT_PATH = "SKILL.md"; // 工具默认读取主文件，标题省略该路径。

/** 标题描述本次调用尝试读取的目标，执行权限与路径校验仍由工具负责。 */
export function format_agent_tool_label(tool_name: string, input: string): string {
  if (tool_name !== "read_skill") return tool_name;
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    // 无法解释的调用输入仍可在详情查看，摘要保留工具名。
    return tool_name;
  }
  if (!is_json_record(value)) return tool_name;
  const name = value["name"];
  const path = value["path"];
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    (path !== undefined && (typeof path !== "string" || path === ""))
  )
    return tool_name;
  const target =
    path === undefined || path === SKILL_DOCUMENT_PATH
      ? name
      : `${name}\\${path.replaceAll("/", "\\")}`;
  return `${tool_name} · ${target}`;
}
