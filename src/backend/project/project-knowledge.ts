import type { Locale } from "../../domain/app-language";
import { AGENT_DOCUMENT_MAX_BYTES } from "../../shared/agent";
import { format_i18n_message } from "../../shared/i18n";
import type { KnowledgeFile } from "../../shared/project-knowledge";
import { JsonTool } from "../../shared/utils/json-tool";
import { agent_workspace_fingerprint } from "./agent-workspace-fingerprint";

/** 导入时选择的来源路径，旧工程首次补记时按界面语言生成模板。 */
export type KnowledgeSourceRecord = Readonly<{ paths: readonly string[]; locale: Locale }>;

/** 模板章节的固定顺序，与 `knowledge-creator` 技能的章节表一一对应。 */
const PROJECT_KNOWLEDGE_SECTIONS = ["decisions", "materials", "tasks", "paths"] as const;

/**
 * 指纹绑定已保存的正文，尚未保存时绑定空基线。
 * 补位模板随界面语言变化，不参与指纹，避免切换语言让未保存的知识产生冲突。
 */
export function project_knowledge_fingerprint(stored: string | null): string {
  return agent_workspace_fingerprint(JsonTool.stringifyStrict(["knowledge", stored]));
}

/** 页面和工作区读取同一份正文，旧工程尚未保存时按当前界面语言补一份模板。 */
export function project_knowledge_file(stored: string | null, locale: Locale): KnowledgeFile {
  return {
    text: stored ?? project_knowledge_template(locale),
    fp: project_knowledge_fingerprint(stored),
  };
}

/** 本地路径是末节，导入时追加到文末的路径即落在该节。 */
export function project_knowledge_template(locale: Locale): string {
  const t = (key: "title" | (typeof PROJECT_KNOWLEDGE_SECTIONS)[number]) =>
    format_i18n_message(locale, `project_knowledge.${key}`);
  return `# ${t("title")}\n\n${PROJECT_KNOWLEDGE_SECTIONS.map((key) => `## ${t(key)}\n`).join("\n")}`;
}

/** 页面、导入和 AGENT 写入共用的正文上限。 */
export function project_knowledge_text_too_large(text: string): boolean {
  return Buffer.byteLength(text, "utf8") > AGENT_DOCUMENT_MAX_BYTES;
}

/**
 * 把文中尚未出现的路径追加到文末，每行一个，尚未保存时先补模板。
 * 路径只是参考信息，超过上限时跳过，让资产导入照常提交。
 */
export function record_source_paths(
  stored: string | null,
  record: KnowledgeSourceRecord,
): string | null {
  const base = stored ?? project_knowledge_template(record.locale);
  const missing = [...new Set(record.paths.map((value) => value.trim()))].filter(
    (value) => value && !base.includes(value),
  );
  if (!missing.length) return null;
  const separator = base === "" || base.endsWith("\n") ? "" : "\n";
  const text = `${base}${separator}${missing.map((path) => `- ${path}\n`).join("")}`;
  return project_knowledge_text_too_large(text) ? null : text;
}
