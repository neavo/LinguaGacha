import path from "node:path";
import { random_id } from "../../../shared/utils/identifier";
import { AppError } from "../../../shared/error";
import type { NativeFs } from "../../../native/native-fs";

export const AGENT_WORKSPACE_LIMIT = 20;
const AGENT_SESSION_ID_LENGTH = 8;
// 回收只识别已使用的会话目录命名范围，覆盖 Base64url 与 Base62，独立于新身份生成策略。
const SESSION_DIRECTORY_PATTERN = /^[A-Za-z0-9_-]{8}$/u;

/** 只管理 workspace 的直接会话子目录，目录链接的目标不参与递归清理。 */
export class AgentWorkspaceDirectories {
  /** 目录操作复用原生 IO，维护失败进入调用方诊断。 */
  constructor(
    private readonly root: string,
    private readonly fs: NativeFs,
    private readonly report: (error: unknown) => void,
  ) {}

  /** 持久身份原样定位直接子目录，路径约束集中在文件系统入口。 */
  public path(id: string): string {
    // 分隔符和盘符会改变路径归属，末尾点或空格会被 Windows 归一化。
    if (id === "" || /[\\/\0:]/u.test(id) || /[. ]$/u.test(id))
      throw new AppError("request.validation_failed");
    return path.join(this.root, id);
  }

  /** 原子占用随机目录，撞名时生成新的身份。 */
  public async create(): Promise<string> {
    await this.fs.make_dir_async(this.root);
    for (;;) {
      const id = random_id(AGENT_SESSION_ID_LENGTH);
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
            SESSION_DIRECTORY_PATTERN.test(entry.name) &&
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
