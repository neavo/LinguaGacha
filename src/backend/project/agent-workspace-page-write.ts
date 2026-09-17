import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { AGENT_WORKSPACE_FP_LENGTH } from "../../shared/project/agent-workspace";
import type { PDFDocumentRecord, PDFPageRecord, PDFPage, PDFPageUpdate } from "../../shared/pdf";
import { render_pdf_page_translation } from "../file/formats/pdf/pdf-translation";
import type { AgentWorkspaceRejectedChange } from "./agent-workspace-write";

/** 工作区提交按来源页定位，line 只用于回执定位提交文件中的记录。 */
export type AgentWorkspacePageUpdateIntent = Readonly<
  PDFPageUpdate & {
    file_path: string; // 与原稿页码共同定位页面。
    page: number; // 从 1 开始的原稿页码。
    fp: string; // 快照中的页面事实指纹。
    line: number; // 变更清单中的物理行号。
  }
>;

/** 页指纹绑定路径与原稿摘要；邻页修改不影响本页，来源替换会使旧快照失效。 */
export function agent_workspace_page_fingerprint(
  file_path: string,
  digest: string,
  page: PDFPage,
): string {
  const translation = page.translation;
  const facts = [
    // 固定字段顺序消除 JSON 键序差异，页指纹与其它工作区对象使用同一摘要长度。
    file_path,
    digest,
    page.page,
    page.width,
    page.height,
    page.rotation,
    page.label,
    translation === null
      ? null
      : translation.kind !== "translate"
        ? [translation.kind, translation.reason]
        : [
            "translate",
            translation.markdown,
            translation.background
              ? [
                  translation.background.page,
                  translation.background.x,
                  translation.background.y,
                  translation.background.width,
                  translation.background.height,
                ]
              : null,
          ],
    page.reviewed,
    page.notes,
  ];
  return createHash("sha256")
    .update(JSON.stringify(facts))
    .digest("base64url")
    .slice(0, AGENT_WORKSPACE_FP_LENGTH);
}

/** 预演与事务提交共用页级校验，冲突只拒绝对应原页。 */
export function resolve_agent_workspace_page_updates(
  intents: readonly AgentWorkspacePageUpdateIntent[],
  documents: readonly PDFDocumentRecord[],
) {
  const changes: PDFPageRecord[] = [];
  const candidates: AgentWorkspacePageUpdateIntent[] = [];
  const rejected: AgentWorkspaceRejectedChange[] = [];
  const counts = new Map<string, number>(); // 先统计整批，使同页的全部重复行一起拒绝。
  /** 结构化编码避免文件路径中的分隔符与页码产生身份歧义。 */
  const key = (intent: AgentWorkspacePageUpdateIntent) =>
    JSON.stringify([intent.file_path, intent.page]);
  for (const intent of intents) counts.set(key(intent), (counts.get(key(intent)) ?? 0) + 1);
  const by_path = new Map(documents.map((record) => [record.file_path, record.document]));
  for (const intent of intents) {
    /** 回执同时定位业务页面与提交行，便于只恢复被拒绝的变更。 */
    const reject = (reason: AgentWorkspaceRejectedChange["reason"], message?: string) =>
      rejected.push({
        scope: "pages",
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
    if (
      agent_workspace_page_fingerprint(intent.file_path, document.digest, current) !== intent.fp
    ) {
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
