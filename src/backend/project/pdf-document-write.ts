import { isDeepStrictEqual } from "node:util";
import type { PDFDocumentRecord } from "../../shared/pdf";
import { pdf_document_fingerprint, type PDFUpdateIntent } from "../file/formats/pdf/pdf-source";
import { render_pdf_translation } from "../file/formats/pdf/pdf-translation";
import type { AgentWorkspaceRejectedChange } from "./agent-workspace-write";

/** 预演与事务提交共用文档级校验，整份译稿接受或拒绝。 */
export function resolve_pdf_updates(
  intents: readonly PDFUpdateIntent[],
  documents: readonly PDFDocumentRecord[],
) {
  const changes: PDFDocumentRecord[] = [];
  const candidates: PDFUpdateIntent[] = [];
  const rejected: AgentWorkspaceRejectedChange[] = [];
  const counts = new Map<string, number>();
  for (const intent of intents)
    counts.set(intent.file_path, (counts.get(intent.file_path) ?? 0) + 1);
  for (const intent of intents) {
    const reject = (reason: AgentWorkspaceRejectedChange["reason"], message?: string) =>
      rejected.push({
        scope: "pdf",
        op: "update",
        file_path: intent.file_path,
        line: intent.line,
        reason,
        ...(message ? { message } : {}),
      });
    if (counts.get(intent.file_path)! > 1) {
      reject("merge_conflict");
      continue;
    }
    const current = documents.find((record) => record.file_path === intent.file_path)?.document;
    if (!current) {
      reject("target_missing");
      continue;
    }
    if (pdf_document_fingerprint(current) !== intent.fp) {
      reject("fp_mismatch");
      continue;
    }
    try {
      render_pdf_translation(intent.translation, current.source);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      reject("invalid_change", error.message);
      continue;
    }
    if (isDeepStrictEqual(current.translation, intent.translation)) continue;
    changes.push({
      file_path: intent.file_path,
      document: { source: current.source, translation: intent.translation },
    });
    candidates.push(intent);
  }
  return { changes, candidates, rejected };
}
