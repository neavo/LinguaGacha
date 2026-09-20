import { api_upload } from "@frontend/app/desktop/desktop-api";
import type { AgentFileAttachment, AgentMessageAttachment, AgentMessageInput } from "@shared/agent";

export type AgentPendingUpload = {
  kind: "upload";
  id: string; // 前端占位身份，上传成功后由后端文件记录替换
  name: string;
  size: number;
  status: "uploading" | "failed";
};
export type AgentDraftAttachment = AgentMessageAttachment | AgentPendingUpload;
export type AgentDraft = Readonly<{ text: string; attachments: readonly AgentDraftAttachment[] }>;
type UploadTask = Readonly<{ file: File; controller: AbortController }>;

/** 上传属于草稿会话；组件卸载只取消订阅，清空草稿才取消任务。 */
export class AgentInputDraft {
  private value: AgentDraft; // React 订阅的稳定快照，写入时替换
  private readonly listeners = new Set<() => void>();
  private readonly tasks = new Map<string, UploadTask>(); // 原始 File 只保留到成功、移除或清理
  private tail = Promise.resolve(); // 同一草稿按选择顺序串行传输

  /** 编辑历史消息时复制初始内容，隔离公开历史。 */
  constructor(initial: AgentMessageInput = { text: "", attachments: [] }) {
    this.value = structuredClone(initial);
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
    this.value = value;
    for (const [id, task] of this.tasks) {
      if (
        !value.attachments.some(
          (attachment) => attachment.kind === "upload" && attachment.id === id,
        )
      ) {
        task.controller.abort();
        this.tasks.delete(id);
      }
    }
    for (const listener of this.listeners) listener();
  };

  /** 先按选择顺序插入占位，再启动串行上传。 */
  public append(files: Iterable<File>): void {
    const additions: AgentPendingUpload[] = [];
    for (const file of files) {
      const id = crypto.randomUUID();
      this.tasks.set(id, { file, controller: new AbortController() });
      additions.push({ kind: "upload", id, name: file.name, size: file.size, status: "uploading" });
    }
    this.write({ ...this.value, attachments: [...this.value.attachments, ...additions] });
    for (const item of additions) this.enqueue(item.id);
  }

  /** 失败项保留原文件和身份，在原位置重新排队。 */
  public retry(id: string): void {
    const item = this.value.attachments.find((item) => item.kind === "upload" && item.id === id);
    if (item?.kind !== "upload" || item.status !== "failed") return;
    this.replace(id, { ...item, status: "uploading" });
    this.enqueue(id);
  }

  /** 编辑器卸载取消在途任务，保留初始化内容以支持 React effect 重连。 */
  public cancel_uploads(): void {
    this.write({
      ...this.value,
      attachments: this.value.attachments.filter((item) => item.kind !== "upload"),
    });
    this.tail = Promise.resolve();
  }

  /** 受理或重置后清空草稿，新任务独立于旧传输收尾。 */
  public clear(): void {
    this.write({ text: "", attachments: [] });
    this.tail = Promise.resolve();
  }

  /** 失败保留可重试占位，取消后的结果随旧任务丢弃。 */
  private enqueue(id: string): void {
    this.tail = this.tail.then(async () => {
      const task = this.tasks.get(id);
      if (task === undefined) return;
      try {
        const file = await api_upload<AgentFileAttachment>(
          `/api/agent/uploads?name=${encodeURIComponent(task.file.name)}`,
          task.file,
          task.controller.signal,
        );
        if (task.controller.signal.aborted) return;
        this.tasks.delete(id);
        this.replace(id, file);
      } catch {
        if (task.controller.signal.aborted) return;
        this.replace(id, {
          kind: "upload",
          id,
          name: task.file.name,
          size: task.file.size,
          status: "failed",
        });
      }
    });
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
