import { isMap, parseDocument } from "yaml";
import type { AgentSkillDocument } from "../../shared/agent-skills";
import { validate_agent_skill_document } from "../../shared/agent-skills";
import { AppError } from "../../shared/error";

/** 开头的完整空白行属于 元数据分隔区，首个内容行的缩进及其后文本保持原样。 */
function read_skill_body(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "");
}

/** 解析主文件结构，元数据与正文之间的空白不进入编辑正文。 */
function parse_skill_document(text: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new AppError("file.invalid_structure");
  const yaml = parseDocument(match[1]);
  if (yaml.errors.length || !isMap(yaml.contents)) throw new AppError("file.invalid_structure");
  const newline = match[0].includes("\r\n") ? "\r\n" : "\n";
  const header = match[0].endsWith("\n") ? match[0] : match[0] + newline;
  return { yaml, header, newline, body: read_skill_body(text.slice(match[0].length)) };
}

/** 把元数据和正文投影为表单，省略的名称沿用加载器提供的目录名。 */
export function read_agent_skill_document(text: string, fallback_name = ""): AgentSkillDocument {
  const { yaml, body } = parse_skill_document(text);
  const declared_name = yaml.get("name");
  const name = typeof declared_name === "string" && declared_name ? declared_name : fallback_name;
  const description = yaml.get("description");
  if (typeof name !== "string" || typeof description !== "string")
    throw new AppError("file.invalid_structure");
  return { name, description: description.replace(/[\r\n]+/g, " "), body };
}

/** 保留额外 YAML 字段与正文空白，结构分隔统一为一个空行。 */
export function write_agent_skill_document(original: string, value: AgentSkillDocument): string {
  const field = validate_agent_skill_document(value);
  if (field) throw new AppError("request.validation_failed", { public_details: { field } });
  const { yaml, header, newline } = parse_skill_document(original);
  const body = read_skill_body(value.body);
  if (yaml.get("name") === value.name && yaml.get("description") === value.description)
    return header + newline + body;
  yaml.set("name", value.name);
  yaml.set("description", value.description);
  return `---\n${yaml.toString()}---\n\n${body}`;
}
