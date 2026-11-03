import { read_markdown_frontmatter } from "../../shared/utils/markdown-frontmatter";
import type { AgentSkillDocument } from "../../shared/agent-skills";
import {
  normalize_agent_skill_text,
  validate_agent_skill_document,
} from "../../shared/agent-skills";
import { AppError } from "../../shared/error";

/** 结束标记所在行之后的所有内容属于正文，包括起始空白行。 */
function parse_skill_document(text: string, fallback_name: string) {
  const document = read_markdown_frontmatter(text, true); // 技能保留对未引用散文标量的既有修复。
  if (!document)
    throw new AppError("file.invalid_structure", { diagnostic_context: { field: "frontmatter" } });
  const { yaml, header, body } = document;
  // 元数据与原文来自同一次解析，正文保存可复用已校验的头部。
  const raw_name = yaml.get("name");
  const raw_description = yaml.get("description");
  if ((raw_name != null && typeof raw_name !== "string") || typeof raw_description !== "string")
    throw new AppError("file.invalid_structure", {
      diagnostic_context: { field: typeof raw_description !== "string" ? "description" : "name" },
    });
  const name =
    normalize_agent_skill_text(raw_name ?? "") || normalize_agent_skill_text(fallback_name);
  const description = normalize_agent_skill_text(raw_description);
  const manual = yaml.get("disable-model-invocation");
  const field = validate_agent_skill_document({ name, description });
  if (field) throw new AppError("file.invalid_structure", { diagnostic_context: { field } });
  if (manual !== undefined && typeof manual !== "boolean")
    throw new AppError("file.invalid_structure", {
      diagnostic_context: { field: "disable-model-invocation" },
    });
  return {
    yaml,
    header,
    metadata: {
      name,
      description,
      body,
      disableModelInvocation: manual === true,
    },
  };
}

/** 加载和编辑共用解析及校验，额外字段留在原文中，描述按单行消费。 */
export function read_agent_skill_metadata(
  text: string,
  fallback_name = "",
): AgentSkillDocument & { disableModelInvocation: boolean } {
  return parse_skill_document(text, fallback_name).metadata;
}

/** 编辑接口只返回用户可编辑字段。 */
export function read_agent_skill_document(text: string, fallback_name = ""): AgentSkillDocument {
  const { name, description, body } = read_agent_skill_metadata(text, fallback_name);
  return { name, description, body };
}

/** 保留额外 YAML 字段与正文空白，只在正文需要时补齐结束标记所在行的换行。 */
export function write_agent_skill_document(
  original: string,
  value: AgentSkillDocument,
  fallback_name = "",
): string {
  const field = validate_agent_skill_document(value);
  if (field) throw new AppError("request.validation_failed", { public_details: { field } });
  const { yaml, header, metadata: previous } = parse_skill_document(original, fallback_name);
  const { body } = value;
  const name = normalize_agent_skill_text(value.name);
  const description = normalize_agent_skill_text(value.description);
  if (previous.name === name && previous.description === description) {
    const newline = body && !header.endsWith("\n") ? (header.includes("\r\n") ? "\r\n" : "\n") : "";
    return header + newline + body;
  }
  if (previous.name !== name) yaml.set("name", name);
  if (previous.description !== description) yaml.set("description", description);
  return `---\n${yaml.toString()}---\n${body}`;
}
