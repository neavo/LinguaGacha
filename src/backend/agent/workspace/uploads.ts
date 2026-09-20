import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentFileAttachment } from "../../../shared/agent";
import { AppError, is_app_error } from "../../../shared/error";
import type { NativeFs } from "../../../native/native-fs";
import { AGENT_IMAGE_INPUT_MAX_BYTES, read_image_type } from "../agent-image-service";

const AGENT_UPLOAD_ROOT = "uploads";
const NAME_MAX_CHARACTERS = 80;
const IMAGE_HEADER_BYTES = 256;

/** 当前会话上传文件的唯一写入者；完整发布后才向草稿和模型暴露身份。 */
export class AgentUploadStore {
  private readonly records = new Map<string, AgentFileAttachment>(); // 只登记完整发布的文件
  private readonly pending = new Set<Promise<AgentFileAttachment>>(); // 清理等待这些任务释放文件句柄
  private lifetime = new AbortController(); // 会话失效后拒绝新上传并取消旧读取
  private clearing: Promise<void> | null = null; // 并发清理共用一次目录删除

  /** 上传目录固定在工作区根下，磁盘操作统一经过 `NativeFs`。 */
  constructor(
    private readonly root: string,
    private readonly fs: NativeFs,
  ) {}

  /** 每次上传捕获当前会话的取消信号，登记到关闭屏障。 */
  public upload(
    name: string,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<AgentFileAttachment> {
    if (this.lifetime.signal.aborted) return Promise.reject(new AppError("runtime.busy"));
    const operation = this.save(name, body, AbortSignal.any([signal, this.lifetime.signal]));
    this.pending.add(operation);
    // 原 `Promise` 向请求方报告失败，此分支只移除在途登记。
    void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
    return operation;
  }

  /** 返回当前会话的记录副本，客户端提供的路径不参与定位。 */
  public get(id: string): AgentFileAttachment {
    const record = this.records.get(id);
    if (record === undefined) throw new AppError("file.not_found");
    return { ...record };
  }

  /** 菜单只枚举已经发布的当前会话文件，半成品不进入候选。 */
  public list(): AgentFileAttachment[] {
    return [...this.records.values()].map((file) => ({ ...file }));
  }

  /** 普通文件可流式下载；发送图片才读取有界的完整字节。 */
  public read_image(id: string): Uint8Array {
    const record = this.get(id);
    const file = path.join(this.root, record.path);
    if (this.fs.stat(file).size > AGENT_IMAGE_INPUT_MAX_BYTES)
      throw new AppError("request.validation_failed", {
        public_details: { reason: "image_input_too_large" },
      });
    return this.fs.read_file(file);
  }

  /** 同一次身份查询提供响应元数据与文件流，响应消费方负责关闭流。 */
  public open(id: string): {
    file: AgentFileAttachment;
    stream: ReturnType<NativeFs["create_read_stream"]>;
  } {
    const file = this.get(id);
    return { file, stream: this.fs.create_read_stream(path.join(this.root, file.path)) };
  }

  /** 清理先失效身份并取消上传，等文件句柄关闭后才删除目录。 */
  public clear(): Promise<void> {
    if (this.clearing !== null) return this.clearing;
    this.cancel();
    const operation = Promise.allSettled(this.pending)
      .then(() =>
        this.fs.remove_async(path.join(this.root, AGENT_UPLOAD_ROOT), {
          recursive: true,
          force: true,
        }),
      )
      .finally(() => {
        this.lifetime = new AbortController();
        this.clearing = null;
      });
    this.clearing = operation;
    return operation;
  }

  /** 停止受理并解除身份，目录删除由工作区等待工具退出后执行。 */
  public cancel(): void {
    this.lifetime.abort(new AppError("runtime.cancelled"));
    this.records.clear();
  }

  /** 流式写入临时文件，关闭句柄后在同一回合内发布路径和身份。 */
  private async save(
    name: string,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<AgentFileAttachment> {
    const id = randomUUID().replaceAll("-", "");
    const filename = upload_filename(name, id);
    const directory = path.join(this.root, AGENT_UPLOAD_ROOT);
    const temporary = path.join(directory, `.${id}.part`);
    const destination = path.join(directory, filename);
    const reader = body.getReader();
    const cancel = (): void => {
      void reader.cancel(signal.reason).catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    let published = false; // 失败时只删除当前上传的半成品
    try {
      signal.throwIfAborted();
      await this.fs.make_dir_async(directory);
      let size = 0;
      let header = Buffer.alloc(0);
      {
        await using handle = await this.fs.open_file(temporary, "wx");
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (header.length < IMAGE_HEADER_BYTES)
            header = Buffer.concat([
              header,
              chunk.value.subarray(0, IMAGE_HEADER_BYTES - header.length),
            ]);
          await handle.writeFile(chunk.value);
        }
      }
      signal.throwIfAborted();
      // 发布和登记在同一同步回合内完成，reset 无法插入两者之间。
      this.fs.rename(temporary, destination);
      const record: AgentFileAttachment = {
        kind: "file",
        uploadId: id,
        name,
        path: `${AGENT_UPLOAD_ROOT}/${filename}`,
        size,
        imageMimeType: read_image_type(header),
      };
      this.records.set(id, record);
      published = true;
      return { ...record };
    } catch (cause) {
      signal.throwIfAborted();
      if (is_app_error(cause)) throw cause;
      throw new AppError("file.io_failed", { cause });
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => undefined); // 断线后流可能已关闭，文件清理仍须完成。
      reader.releaseLock();
      if (!published) await this.fs.remove_async(temporary, { force: true });
    }
  }
}

/** 保留可读名称与扩展名，身份后缀同时避免同名覆盖和跨会话误用。 */
function upload_filename(name: string, id: string): string {
  const safe =
    name
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}_.-]/gu, "_")
      .replace(/^[.-]+|[.]+$/gu, "") || "file";
  const suffix = path.extname(safe);
  const extension = Array.from(suffix)
    .slice(0, NAME_MAX_CHARACTERS - 1)
    .join("");
  const stem = Array.from(suffix === "" ? safe : safe.slice(0, -suffix.length))
    .slice(0, NAME_MAX_CHARACTERS - Array.from(extension).length)
    .join("");
  return `${stem}_${id}${extension}`;
}
