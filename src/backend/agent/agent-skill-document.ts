import { isMap, parseDocument } from "yaml";
import type { AgentSkillDocument } from "../../shared/agent-skills";
import {
  normalize_agent_skill_text,
  validate_agent_skill_document,
} from "../../shared/agent-skills";
import { AppError } from "../../shared/error";

/** 结束标记所在行之后的所有内容属于正文，包括起始空白行。 */
function parse_skill_document(text: string, fallback_name: string) {
  const match =
    /^(?:\uFEFF)?[^\S\r\n]*---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n[^\S\r\n]*---[^\S\r\n]*(?:\r?\n|$)/.exec(
      text,
    );
  if (!match)
    throw new AppError("file.invalid_structure", { diagnostic_context: { field: "frontmatter" } });
  let yaml = parseDocument(match[1]!);
  if (yaml.errors.length) yaml = parseDocument(repair_scalar_fields(match[1]!));
  if (yaml.errors.length) throw new AppError("file.invalid_structure", { cause: yaml.errors[0] });
  if (!isMap(yaml.contents))
    throw new AppError("file.invalid_structure", { diagnostic_context: { field: "frontmatter" } });
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
    header: match[0],
    metadata: {
      name,
      description,
      body: text.slice(match[0].length),
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

/** 仅修复未加引号的散文标量；块字符串和已引用标量保持原样。 */
function repair_scalar_fields(frontmatter: string): string {
  let block_indent: number | null = null; // 当前块字符串的字段缩进，后代行不参与修复。
  return frontmatter
    .split(/\r?\n/)
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      if (block_indent !== null) {
        if (!line.trim() || indent > block_indent) return line;
        block_indent = null;
      }
      const match = /^(\s*[^:]+:)(\s+)(.*)$/.exec(line);
      if (!match) return line;
      const [, key, spacing, raw] = match;
      const comment_at = raw!.search(/(?:^|\s)#/);
      const value = (comment_at < 0 ? raw! : raw!.slice(0, comment_at)).trimEnd();
      const comment = comment_at < 0 ? "" : raw!.slice(value.length);
      if (/^[|>]/.test(value)) {
        block_indent = indent;
        return line;
      }
      if (!value || /^['"]/.test(value)) return line;
      const flow = /^[[{@`]/.test(value) && parseDocument(value).errors.length > 0;
      if (!/:\s/.test(value) && !flow) return line;
      return `${key}${spacing}'${value.replaceAll("'", "''")}'${comment}`;
    })
    .join("\n");
}
