import { isDeepStrictEqual } from "node:util";
import type { PDFDocumentRecord, PDFPageRecord } from "../../shared/pdf";
import { pdf_page_fingerprint, type PDFUpdateIntent } from "../file/formats/pdf/pdf-source";
import { render_pdf_page_translation } from "../file/formats/pdf/pdf-translation";
import type { AgentWorkspaceRejectedChange } from "./agent-workspace-write";

/** 预演与事务提交共用页级校验，冲突只拒绝对应原页。 */
export function resolve_pdf_updates(
  intents: readonly PDFUpdateIntent[],
  documents: readonly PDFDocumentRecord[],
) {
  const changes: PDFPageRecord[] = [];
  const candidates: PDFUpdateIntent[] = [];
  const rejected: AgentWorkspaceRejectedChange[] = [];
  const counts = new Map<string, number>(); // 先统计整批，使同页的全部重复行一起拒绝。
  const key = (intent: PDFUpdateIntent) => JSON.stringify([intent.file_path, intent.page]);
  for (const intent of intents) counts.set(key(intent), (counts.get(key(intent)) ?? 0) + 1);
  const by_path = new Map(documents.map((record) => [record.file_path, record.document]));
  for (const intent of intents) {
    const reject = (reason: AgentWorkspaceRejectedChange["reason"], message?: string) =>
      rejected.push({
        scope: "pdf",
        op: "update",
        file_path: intent.file_path,
        page: intent.page,
        line: intent.line,
        reason,
        ...(message ? { message } : {}),
      });
    if (counts.get(key(intent))! > 1) {
      reject("merge_conflict");
      continue;
    }
    const document = by_path.get(intent.file_path);
    const current = document?.pages[intent.page - 1];
    if (!document || !current) {
      reject("target_missing");
      continue;
    }
    if (pdf_page_fingerprint(intent.file_path, document.digest, current) !== intent.fp) {
      reject("fp_mismatch");
      continue;
    }
    const next = {
      ...current,
      translation: intent.translation,
      reviewed: intent.reviewed,
      notes: intent.notes,
    };
    try {
      render_pdf_page_translation(next, document);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      reject("invalid_change", error.message);
      continue;
    }
    if (isDeepStrictEqual(current, next)) continue;
    changes.push({ file_path: intent.file_path, page: next });
    candidates.push(intent);
  }
  return { changes, candidates, rejected };
}
