import { isMap, parseDocument } from "yaml";
import type { AgentSkillDocument } from "../../shared/agent-skills";
import { validate_agent_skill_document } from "../../shared/agent-skills";
import { AppError } from "../../shared/error";

/** 结束标记所在行之后的所有内容属于正文，包括起始空白行。 */
function parse_skill_document(text: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match)
    throw new AppError("file.invalid_structure", { diagnostic_context: { field: "frontmatter" } });
  const yaml = parseDocument(match[1]);
  if (yaml.errors.length) throw new AppError("file.invalid_structure", { cause: yaml.errors[0] });
  if (!isMap(yaml.contents))
    throw new AppError("file.invalid_structure", { diagnostic_context: { field: "frontmatter" } });
  return { yaml, header: match[0], body: text.slice(match[0].length) };
}

/** 加载和编辑共用解析及校验，额外字段留在原文中，描述按单行消费。 */
export function read_agent_skill_metadata(
  text: string,
): AgentSkillDocument & { disableModelInvocation: boolean } {
  const { yaml, body } = parse_skill_document(text);
  const name = yaml.get("name");
  const raw_description = yaml.get("description");
  const description =
    typeof raw_description === "string"
      ? raw_description.replace(/[\r\n]+/g, " ")
      : raw_description;
  const manual = yaml.get("disable-model-invocation");
  const field = validate_agent_skill_document({ name, description });
  if (field) throw new AppError("file.invalid_structure", { diagnostic_context: { field } });
  if (manual !== undefined && typeof manual !== "boolean")
    throw new AppError("file.invalid_structure", {
      diagnostic_context: { field: "disable-model-invocation" },
    });
  return {
    name: name as string,
    description: description as string,
    body,
    disableModelInvocation: manual === true,
  };
}

/** 编辑接口只返回用户可编辑字段。 */
export function read_agent_skill_document(text: string): AgentSkillDocument {
  const { name, description, body } = read_agent_skill_metadata(text);
  return { name, description, body };
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
