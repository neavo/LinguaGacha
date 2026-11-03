import type { Locale } from "../../domain/app-language";
import { AGENT_DOCUMENT_MAX_BYTES } from "../../shared/agent";
import { normalize_agent_skill_text } from "../../shared/agent-skills";
import { AppError } from "../../shared/error";
import { format_i18n_message } from "../../shared/i18n";
import type {
  KnowledgeDocument,
  KnowledgeEntry,
  KnowledgeIntent,
} from "../../shared/project-knowledge";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../shared/project/project-asset-paths";
import { validate_file_name } from "../../shared/utils/file-name";
import { JsonTool } from "../../shared/utils/json-tool";
import { read_markdown_frontmatter } from "../../shared/utils/markdown-frontmatter";
import { agent_workspace_fingerprint } from "./agent-workspace-fingerprint";
import type { AgentWorkspaceRejectedChange } from "./agent-workspace-write";

export type KnowledgeWrite = Readonly<{ path: string; text: string | null }>;
export type KnowledgeSourceRecord = Readonly<{
  action: "create" | "import";
  paths: readonly string[];
  locale: Locale;
}>;

/** 写入和磁盘投影共用相对路径与文件名约束。 */
export function normalize_knowledge_path(value: string): string {
  const normalized = normalize_project_asset_path(value);
  for (const part of normalized.split("/")) validate_file_name(part);
  if (!normalized.toLowerCase().endsWith(".md"))
    throw new AppError("request.validation_failed", {
      public_details: { reason: "knowledge_path_requires_md" },
    });
  return normalized;
}

/** 校验整篇正文，只向索引公开可选的单行描述。 */
export function read_knowledge_description(text: string): string | undefined {
  if (Buffer.byteLength(text, "utf8") > AGENT_DOCUMENT_MAX_BYTES)
    throw new AppError("request.validation_failed", {
      public_details: { reason: "knowledge_document_too_large" },
    });
  const document = read_markdown_frontmatter(text);
  const description: unknown = document?.yaml.get("description");
  if (!document || !document.yaml.has("description")) return undefined;
  if (typeof description !== "string")
    throw new AppError("request.validation_failed", {
      public_details: { reason: "knowledge_description_requires_string" },
    });
  return normalize_agent_skill_text(description);
}

/** 指纹绑定路径和正文，使无关文档的修改不产生冲突。 */
export function project_knowledge_fingerprint(path: string, text: string): string {
  return agent_workspace_fingerprint(JsonTool.stringifyStrict(["knowledge", path, text]));
}

/** 管理页与工作区读取同一份知识索引。 */
export function project_knowledge_entry(document: KnowledgeDocument): KnowledgeEntry {
  normalize_knowledge_path(document.path); // 分享的工程也须在投影为本机文件前校验路径。
  const description = read_knowledge_description(document.text);
  return {
    path: document.path,
    ...(description === undefined ? {} : { description }),
    fp: project_knowledge_fingerprint(document.path, document.text),
  };
}

/** 页面和工作区在事务内重放同一批意图，删除先释放路径以支持改名。 */
export function resolve_knowledge_changes(
  current: readonly KnowledgeDocument[],
  intents: readonly KnowledgeIntent[],
) {
  const rejected: AgentWorkspaceRejectedChange[] = [];
  const candidates: KnowledgeIntent[] = [];
  const existing = new Map(current.map((document) => [document.path.toLowerCase(), document]));
  const counts = new Map<string, number>(); // 先统计整批路径，重复操作全部拒绝。
  const normalized: KnowledgeIntent[] = [];
  /** 拒绝记录保留原操作和行号，供页面反馈与 AGENT 修正。 */
  const reject = (
    intent: KnowledgeIntent,
    reason: AgentWorkspaceRejectedChange["reason"],
    message?: string,
  ) => {
    rejected.push({
      scope: "knowledge",
      op: intent.op,
      line: intent.line,
      path: intent.path,
      reason,
      ...(message === undefined ? {} : { message }),
    });
  };
  for (const intent of intents) {
    try {
      const path = normalize_knowledge_path(intent.path);
      normalized.push({ ...intent, path });
      counts.set(path.toLowerCase(), (counts.get(path.toLowerCase()) ?? 0) + 1);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      reject(intent, "invalid_change", "Invalid Markdown document path");
    }
  }
  for (const intent of normalized) {
    const key = intent.path.toLowerCase();
    const document = existing.get(key);
    if (counts.get(key)! > 1) {
      reject(intent, "merge_conflict");
      continue;
    }
    if (intent.op === "create" && document) {
      reject(intent, "invalid_change", "Path already exists; use update");
      continue;
    }
    if (intent.op !== "create") {
      if (!document) {
        reject(intent, "target_missing");
        continue;
      }
      if (intent.fp !== project_knowledge_fingerprint(document.path, document.text)) {
        reject(intent, "fp_mismatch");
        continue;
      }
    }
    if (intent.op !== "delete") {
      try {
        read_knowledge_description(intent.text);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        reject(
          intent,
          "invalid_change",
          String(
            error.public_details["reason"] ?? error.diagnostic_context["field"] ?? error.message,
          ),
        );
        continue;
      }
    }
    candidates.push(document ? { ...intent, path: document.path } : intent);
  }
  // 合法删除先释放名称，允许同批把文件改为目录中的文档。
  const deleted = new Set(
    candidates
      .filter((intent) => intent.op === "delete")
      .map((intent) => intent.path.toLowerCase()),
  );
  const index = new ProjectAssetPathIndex();
  for (const document of current)
    if (!deleted.has(document.path.toLowerCase())) index.add(document.path);
  const writes: KnowledgeWrite[] = [];
  const accepted: KnowledgeIntent[] = [];
  // 回执随真实写入生成，同值更新仍保留为候选但不计入修改数量。
  const summary: { created: string[]; updated: string[]; deleted: string[] } = {
    created: [],
    updated: [],
    deleted: [],
  };
  for (const intent of candidates) {
    if (intent.op === "create") {
      if (index.find_conflict(intent.path) !== null) {
        reject(intent, "invalid_change", "Document path conflicts with a file or directory");
        continue;
      }
      index.add(intent.path);
    }
    accepted.push(intent);
    const text = intent.op === "delete" ? null : intent.text;
    if (existing.get(intent.path.toLowerCase())?.text !== text) {
      writes.push({ path: intent.path, text });
      const paths =
        intent.op === "create"
          ? summary.created
          : intent.op === "update"
            ? summary.updated
            : summary.deleted;
      paths.push(intent.path);
    }
  }
  return { writes, rejected, candidates: accepted, summary: writes.length ? summary : null };
}

/** 来源只是参考信息，达到上限时跳过追加，让资产导入照常提交。 */
export function append_source_record(
  current: string | null,
  record: KnowledgeSourceRecord,
): string | null {
  const paths = [...new Set(record.paths.map((value) => value.trim()).filter(Boolean))];
  if (!paths.length) return null;
  /** 同一条记录使用导入时的界面语言。 */
  const t = (key: "title" | "description" | "create" | "import" | "separator") =>
    format_i18n_message(record.locale, `project_knowledge.${key}`);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const header =
    current ?? `---\ndescription: ${JSON.stringify(t("description"))}\n---\n\n# ${t("title")}\n`;
  const quoted = paths
    .map((value) => {
      const path = value.replaceAll(/\r?\n/g, " ");
      const fence = "`".repeat(
        Math.max(0, ...[...path.matchAll(/`+/g)].map((match) => match[0].length)) + 1,
      );
      return `${fence} ${path} ${fence}`;
    })
    .join(t("separator"));
  const text = `${header}${header.endsWith("\n") ? "" : "\n"}\n- ${date} · ${t(record.action)}: ${quoted}\n`;
  return Buffer.byteLength(text, "utf8") <= AGENT_DOCUMENT_MAX_BYTES ? text : null;
}
