import type { api_upload } from "@frontend/app/desktop/desktop-api";
import { read_file_path } from "@frontend/app/desktop/source-paths";
import type { AgentFileAttachment, AgentMessageAttachment, AgentMessageInput } from "@shared/agent";

export type AgentPendingUpload = {
  kind: "upload";
  id: string; // 前端占位身份，上传成功后由后端文件记录替换
  name: string;
  size: number;
  status: "uploading" | "failed";
};
export type AgentStagedFile = Readonly<{
  kind: "staged_file";
  id: string;
  name: string;
  size: number;
  file: File;
  sourcePath: string | null;
}>;
export type AgentDraftAttachment = AgentMessageAttachment | AgentPendingUpload | AgentStagedFile;
export type AgentDraft = Readonly<{ text: string; attachments: readonly AgentDraftAttachment[] }>;
type UploadTask = Readonly<{ file: File; controller: AbortController }>;
type UploadFailure = Readonly<{ error: unknown }>;

/** 上传属于草稿会话；组件卸载只取消订阅，清空草稿才取消任务。 */
export class AgentInputDraft {
  private value: AgentDraft; // React 订阅的稳定快照，写入时替换
  private readonly listeners = new Set<() => void>();
  private readonly tasks = new Map<string, UploadTask>(); // 原始 File 只保留到成功、移除或清理
  private tail = Promise.resolve<UploadFailure | undefined>(undefined); // 同一草稿按选择顺序串行传输
  private readonly upload: typeof api_upload | null;

  /** 输入和附件按快照替换。历史附件可共享，编辑时以新记录替换。 */
  constructor(
    upload: typeof api_upload | null,
    initial: AgentMessageInput = { text: "", attachments: [] },
  ) {
    this.upload = upload;
    this.value = { text: initial.text, attachments: initial.attachments };
  }

  /** 返回稳定快照，订阅者据引用变化更新界面。 */
  public readonly read = (): AgentDraft => this.value;
  /** 组件卸载只移除监听，草稿继续拥有上传任务。 */
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** 草稿移除上传占位时同步取消任务，回调统一依据信号判断有效性。 */
  public readonly write = (value: AgentDraft): void => {
    const attachments_changed = value.attachments !== this.value.attachments;
    this.value = value;
    if (attachments_changed && this.tasks.size > 0) {
      const active_ids = new Set(
        value.attachments.filter((item) => item.kind === "upload").map((item) => item.id),
      );
      for (const [id, task] of this.tasks) {
        if (!active_ids.has(id)) {
          task.controller.abort();
          this.tasks.delete(id);
        }
      }
    }
    for (const listener of this.listeners) listener();
  };

  /** 暂存和待重试附件直接入列。批量上传归集首个错误，供已确认发送的调用方反馈。 */
  public async append(
    files: Iterable<File>,
    status: AgentPendingUpload["status"] = "uploading",
  ): Promise<UploadFailure | undefined> {
    const additions: Array<AgentPendingUpload | AgentStagedFile> = [];
    for (const file of files) {
      const id = crypto.randomUUID();
      const { name, size } = file;
      if (this.upload === null) {
        const sourcePath = read_file_path(file);
        additions.push({ kind: "staged_file", id, name, size, file, sourcePath });
      } else {
        this.tasks.set(id, { file, controller: new AbortController() });
        additions.push({ kind: "upload", id, name, size, status });
      }
    }
    if (additions.length === 0) return;
    this.write({ ...this.value, attachments: [...this.value.attachments, ...additions] });
    if (this.upload === null || status === "failed") return;
    const results = await Promise.all(additions.map(({ id }) => this.enqueue(id)));
    return results.find((result) => result !== undefined);
  }

  /** 失败项保留原文件和身份，在原位置重新排队。 */
  public retry(id: string): void {
    const item = this.value.attachments.find((item) => item.kind === "upload" && item.id === id);
    if (item?.kind !== "upload" || item.status !== "failed") return;
    this.replace(id, { ...item, status: "uploading" });
    void this.enqueue(id);
  }

  /** 编辑器卸载取消在途任务，保留初始化内容以支持 React effect 重连。 */
  public cancel_uploads(): void {
    this.write({
      ...this.value,
      attachments: this.value.attachments.filter((item) => item.kind !== "upload"),
    });
    this.tail = Promise.resolve(undefined);
  }

  /** 受理或重置后清空草稿，新任务独立于旧传输收尾。 */
  public clear(): void {
    this.write({ text: "", attachments: [] });
    this.tail = Promise.resolve(undefined);
  }

  /** 失败保留可重试占位，取消后的结果随旧任务丢弃。 */
  private enqueue(id: string): Promise<UploadFailure | undefined> {
    this.tail = this.tail.then(async () => {
      const task = this.tasks.get(id);
      if (task === undefined || this.upload === null) return;
      try {
        const file = await this.upload<AgentFileAttachment>(
          `/api/agent/uploads?name=${encodeURIComponent(task.file.name)}`,
          task.file,
          task.controller.signal,
        );
        if (task.controller.signal.aborted) return;
        this.tasks.delete(id);
        this.replace(id, file);
      } catch (error) {
        if (task.controller.signal.aborted) return;
        this.replace(id, {
          kind: "upload",
          id,
          name: task.file.name,
          size: task.file.size,
          status: "failed",
        });
        return { error };
      }
    });
    return this.tail;
  }

  /** 根据上传身份原位替换，占位期间追加的正文和批注继续保留。 */
  private replace(id: string, attachment: AgentDraftAttachment): void {
    this.write({
      ...this.value,
      attachments: this.value.attachments.map((item) =>
        item.kind === "upload" && item.id === id ? attachment : item,
      ),
    });
  }
}
