import { isMap, parseDocument } from "yaml";
import type { AgentSkillDocument } from "../../shared/agent-skills";
import { validate_agent_skill_document } from "../../shared/agent-skills";
import { AppError } from "../../shared/error";

/** 结束标记所在行之后的所有内容属于正文，包括起始空白行。 */
function parse_skill_document(text: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new AppError("file.invalid_structure");
  const yaml = parseDocument(match[1]);
  if (yaml.errors.length || !isMap(yaml.contents)) throw new AppError("file.invalid_structure");
  return { yaml, header: match[0], body: text.slice(match[0].length) };
}

/** 提供编辑字段与完整正文，省略的名称沿用加载器提供的目录名。 */
export function read_agent_skill_document(text: string, fallback_name = ""): AgentSkillDocument {
  const { yaml, body } = parse_skill_document(text);
  const declared_name = yaml.get("name");
  const name = typeof declared_name === "string" && declared_name ? declared_name : fallback_name;
  const description = yaml.get("description");
  if (typeof name !== "string" || typeof description !== "string")
    throw new AppError("file.invalid_structure");
  return { name, description: description.replace(/[\r\n]+/g, " "), body };
}

/** 保留额外 YAML 字段与正文空白，只在正文需要时补齐结束标记所在行的换行。 */
export function write_agent_skill_document(original: string, value: AgentSkillDocument): string {
  const field = validate_agent_skill_document(value);
  if (field) throw new AppError("request.validation_failed", { public_details: { field } });
  const { yaml, header } = parse_skill_document(original);
  const { body } = value;
  if (yaml.get("name") === value.name && yaml.get("description") === value.description) {
    const newline = body && !header.endsWith("\n") ? (header.includes("\r\n") ? "\r\n" : "\n") : "";
    return header + newline + body;
  }
  yaml.set("name", value.name);
  yaml.set("description", value.description);
  return `---\n${yaml.toString()}---\n${body}`;
}
