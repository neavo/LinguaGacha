import { createHash } from "node:crypto";
import type { JsonRecord, MutableJsonRecord } from "../../domain/json";
import { AppError } from "../../shared/error";
import type { PDFDocument, PDFPage } from "../../shared/pdf";
import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectSessionState } from "../project/project-session-state";
import type { PDFExecution } from "../file/formats/pdf/pdf-worker";

type Preview = {
  id: string;
  key: string;
  source: Uint8Array;
  controller: AbortController;
  translation: Promise<Uint8Array> | null;
};

/** 只保留当前详情的 PDF 字节，图像按页生成，生命周期由详情和工程会话共同限定。 */
export class ProofreadingPagePreview {
  private current: Preview | null = null; // 每次详情独占一份来源和译稿缓存。
  private readonly unsubscribe: () => void; // 生命周期结束时移除工程监听。

  /** 订阅工程切换，使预览与当前会话共同释放。 */
  public constructor(
    private readonly database: Pick<ProjectDatabase, "read_pdf_document" | "read_asset_content">,
    private readonly session: ProjectSessionState,
    private readonly execute: PDFExecution,
  ) {
    this.unsubscribe = session.subscribe_change(() => this.clear());
  }

  /** 先撤销排队与活动计算，再释放当前预览引用。 */
  private clear(): void {
    this.current?.controller.abort();
    this.current = null;
  }

  /** 业务根关闭时同时移除订阅和计算任务。 */
  public dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  /** 来源与译稿共同标识渲染内容，核对和续做标记不影响打印缓存。 */
  private key(document: PDFDocument, page: PDFPage): string {
    return createHash("sha256")
      .update(JSON.stringify([document.digest, page.page, page.translation]))
      .digest("hex");
  }

  /** 在公开边界校验目标，异步完成后再次核对来源与译稿。 */
  public async query(request: JsonRecord): Promise<MutableJsonRecord> {
    const id = request["request_id"];
    const action = request["action"];
    if (typeof id !== "string" || id.length === 0) throw new AppError("request.validation_failed");
    if (action === "close") {
      if (this.current?.id === id) this.clear();
      return {};
    }
    const file_path = request["file_path"];
    const page_number = request["page"];
    const output_page = request["output_page"] ?? 1;
    if (
      (action !== "source" && action !== "translation") ||
      typeof file_path !== "string" ||
      typeof page_number !== "number" ||
      !Number.isInteger(page_number) ||
      page_number < 1 ||
      typeof output_page !== "number" ||
      !Number.isInteger(output_page) ||
      output_page < 1
    ) {
      throw new AppError("request.validation_failed");
    }
    const project_path = this.session.require_loaded_project_path();
    if (request["project_path"] !== project_path) throw new AppError("request.validation_failed");
    const document = this.database.read_pdf_document(project_path, file_path);
    const page = document?.pages[page_number - 1];
    if (!document || !page) throw new AppError("request.validation_failed");
    const key = this.key(document, page);
    if (this.current?.id !== id || this.current.key !== key) {
      this.clear();
      const source = this.database.read_asset_content(project_path, file_path);
      if (!source) throw new AppError("request.validation_failed");
      this.current = {
        id,
        key,
        source: new Uint8Array(source),
        controller: new AbortController(),
        translation: null,
      };
    }
    const preview = this.current;
    const translation = page.translation;
    if (
      action === "translation" &&
      (translation?.kind !== "translate" || translation.markdown.trim() === "")
    )
      return {};
    let bytes = preview.source;
    if (action === "translation") {
      preview.translation ??= this.execute(
        { kind: "preview", bytes: preview.source, title: file_path, document, page: page_number },
        preview.controller.signal,
      )
        .then((value) => {
          if (!(value instanceof Uint8Array)) throw new AppError("runtime.internal_invariant");
          return value;
        })
        .catch((error: unknown) => {
          preview.translation = null;
          throw error;
        });
      bytes = await preview.translation;
    }
    const rendered = await this.execute(
      { kind: "render", bytes, page: action === "source" ? page_number : output_page },
      preview.controller.signal,
    );
    if (this.current !== preview) throw new AppError("request.validation_failed");
    const latest = this.database.read_pdf_document(project_path, file_path);
    const latest_page = latest?.pages[page_number - 1];
    if (!latest || !latest_page || this.key(latest, latest_page) !== key) {
      throw new AppError("request.validation_failed");
    }
    if (!("image" in rendered)) throw new AppError("runtime.internal_invariant");
    return { image: rendered.image, count: rendered.count, page: rendered.page };
  }
}
