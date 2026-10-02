import path from "node:path";
import { randomBytes } from "node:crypto";
import { AGENT_SESSION_ID_BYTES, AGENT_SESSION_ID_PATTERN } from "../../../shared/agent";
import { AppError } from "../../../shared/error";
import type { NativeFs } from "../../../native/native-fs";

export const AGENT_WORKSPACE_LIMIT = 20;

/** 只管理 workspace 的直接会话子目录，目录链接的目标不参与递归清理。 */
export class AgentWorkspaceDirectories {
  /** 目录操作复用原生 IO，维护失败进入调用方诊断。 */
  constructor(
    private readonly root: string,
    private readonly fs: NativeFs,
    private readonly report: (error: unknown) => void,
  ) {}

  /** 准备会话目录的共同父目录。 */
  public async initialize(): Promise<void> {
    await this.fs.make_dir_async(this.root);
  }

  /** 校验单段会话身份后定位目录。 */
  public path(id: string): string {
    if (!AGENT_SESSION_ID_PATTERN.test(id)) throw new AppError("request.validation_failed");
    return path.join(this.root, id);
  }

  /** 原子占用随机目录，撞名时生成新的身份。 */
  public async create(): Promise<string> {
    await this.initialize();
    for (;;) {
      const id = randomBytes(AGENT_SESSION_ID_BYTES).toString("base64url");
      try {
        await this.fs.make_dir_exclusive(this.path(id));
        return id;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    }
  }

  /** 记录最近使用时间，供数量清理排序。 */
  public async touch(id: string): Promise<void> {
    try {
      await this.fs.touch_directory(this.path(id));
    } catch (error) {
      this.report(error);
    }
  }

  /** 删除指定会话材料，失败保留到后续清理重试。 */
  public async remove(id: string): Promise<void> {
    try {
      await this.fs.remove_async(this.path(id), { recursive: true, force: true });
    } catch (error) {
      this.report(error);
    }
  }

  /** 当前目录优先保留。其余只读取根目录时间，不扫描文件内容。 */
  public async prune(active: string): Promise<void> {
    try {
      const candidates = this.fs
        .read_dirents(this.root)
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            AGENT_SESSION_ID_PATTERN.test(entry.name) &&
            entry.name !== active,
        )
        .map((entry) => ({ id: entry.name, modified: this.fs.stat(this.path(entry.name)).mtimeMs }))
        .sort((left, right) => right.modified - left.modified || left.id.localeCompare(right.id));
      for (const entry of candidates.slice(AGENT_WORKSPACE_LIMIT - 1)) await this.remove(entry.id);
    } catch (error) {
      this.report(error);
    }
  }
}
