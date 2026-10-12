import { createHash } from "node:crypto";
import type { JsonRecord, MutableJsonRecord } from "../../domain/json";
import { AppError } from "../../shared/error";
import type { PDFDocument, PDFPage } from "../../shared/pdf";
import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectSessionState } from "../project/project-session-state";
import type { PDFExecution } from "../file/pdf/pdf-worker";

/** 详情对象的身份限定异步请求有效期，两栏共用内容缓存。 */
type Preview = {
  id: string;
  project_path: string;
  file_path: string;
  page: number;
  content: PreviewContent | null;
};

/** 内容更新可单独撤销旧计算，同时保持详情身份。 */
type PreviewContent = {
  key: string;
  source: Promise<Uint8Array>;
  controller: AbortController;
  translation: Promise<Uint8Array> | null;
};

/** 只保留当前详情的 PDF 字节，图像按页生成，生命周期由详情和工程会话共同限定。 */
export class ProofreadingPagePreview {
  private current: Preview | null = null; // 每次详情独占一份来源和译稿缓存。
  private disposed = false; // 释放后拒绝重新建立详情。
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
    this.current?.content?.controller.abort(new AppError("runtime.cancelled"));
    this.current = null;
  }

  /** 业务根关闭时同时移除订阅和计算任务。 */
  public dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.clear();
  }

  /** 来源与译稿共同标识渲染内容，核对和续做标记不影响打印缓存。 */
  private key(document: PDFDocument, page: PDFPage): string {
    return createHash("sha256")
      .update(JSON.stringify([document.digest, page.page, page.translation]))
      .digest("hex");
  }

  /** 初始化读取也属于详情有效期，迟到任务只能结束自身。 */
  private assert_current(preview: Preview, content?: PreviewContent): void {
    if (
      this.disposed ||
      this.current !== preview ||
      (content !== undefined && (preview.content !== content || content.controller.signal.aborted))
    )
      throw new AppError("runtime.cancelled");
  }

  /** 两栏共享资产加载；失败只撤销所属内容，下一次请求可以重新加载。 */
  private load_content(preview: Preview, key: string): PreviewContent {
    const content: PreviewContent = {
      key,
      controller: new AbortController(),
      translation: null,
      source: this.database
        .read_asset_content(preview.project_path, preview.file_path)
        .then((source) => {
          this.assert_current(preview, content);
          if (!source) throw new AppError("request.validation_failed");
          return new Uint8Array(source);
        })
        .catch((error: unknown) => {
          if (preview.content === content) preview.content = null;
          content.controller.abort(error);
          throw error;
        }),
    };
    preview.content = content;
    return content;
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
    if (this.disposed) throw new AppError("runtime.cancelled");
    if (
      this.current?.id !== id ||
      this.current.project_path !== project_path ||
      this.current.file_path !== file_path ||
      this.current.page !== page_number
    ) {
      this.clear();
      this.current = {
        id,
        project_path,
        file_path,
        page: page_number,
        content: null,
      };
    }
    const preview = this.current;
    const previous_content = preview.content;
    const document = await this.database.read_pdf_document(project_path, file_path);
    this.assert_current(preview);
    const page = document?.pages[page_number - 1];
    if (!document || !page) throw new AppError("request.validation_failed");
    const key = this.key(document, page);
    if (preview.content !== null && preview.content.key !== key) {
      // 读取期间另一栏已加载新内容时，旧读取不能覆盖它。
      if (preview.content !== previous_content) throw new AppError("runtime.cancelled");
      preview.content.controller.abort(new AppError("runtime.cancelled"));
      preview.content = null;
    }
    const translation = page.translation;
    if (
      action === "translation" &&
      (translation?.kind !== "translate" || translation.markdown.trim() === "")
    )
      return {};
    const content = preview.content ?? this.load_content(preview, key);
    const source = await content.source;
    this.assert_current(preview, content);
    let bytes = source;
    if (action === "translation") {
      content.translation ??= this.execute(
        { kind: "preview", bytes: source, title: file_path, document, page: page_number },
        content.controller.signal,
      )
        .then((value) => {
          if (!(value instanceof Uint8Array)) throw new AppError("runtime.internal_invariant");
          return value;
        })
        .catch((error: unknown) => {
          content.translation = null;
          throw error;
        });
      bytes = await content.translation;
      this.assert_current(preview, content);
    }
    const rendered = await this.execute(
      { kind: "render", bytes, page: action === "source" ? page_number : output_page },
      content.controller.signal,
    );
    this.assert_current(preview, content);
    const latest = await this.database.read_pdf_document(project_path, file_path);
    this.assert_current(preview, content);
    const latest_page = latest?.pages[page_number - 1];
    if (!latest || !latest_page || this.key(latest, latest_page) !== key) {
      throw new AppError("request.validation_failed");
    }
    if (rendered === null || !("image" in rendered))
      throw new AppError("runtime.internal_invariant");
    return { image: rendered.image, count: rendered.count, page: rendered.page };
  }
}
