import { isMap, parseDocument } from "yaml";
import { AppError } from "../error";

/** 保留头部和正文原文，技能与工程知识共用 Markdown 边界。 */
export function read_markdown_frontmatter(text: string, repair_scalars = false) {
  const match =
    /^(?:\uFEFF)?[^\S\r\n]*---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n[^\S\r\n]*---[^\S\r\n]*(?:\r?\n|$)/.exec(
      text,
    );
  if (!match) {
    if (/^(?:\uFEFF)?[^\S\r\n]*---[^\S\r\n]*(?:\r?\n|$)/.test(text))
      throw new AppError("file.invalid_structure", {
        diagnostic_context: { field: "frontmatter" },
      });
    return null;
  }
  let yaml = parseDocument(match[1]!);
  if (repair_scalars && yaml.errors.length) yaml = parseDocument(repair_scalar_fields(match[1]!));
  if (yaml.errors.length) throw new AppError("file.invalid_structure", { cause: yaml.errors[0] });
  if (!isMap(yaml.contents))
    throw new AppError("file.invalid_structure", { diagnostic_context: { field: "frontmatter" } });
  return { yaml, header: match[0], body: text.slice(match[0].length) };
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
