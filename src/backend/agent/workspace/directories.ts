import path from "node:path";
import { random_id } from "../../../shared/utils/identifier";
import { AppError } from "../../../shared/error";
import type { NativeFs } from "../../../native/native-fs";

export const AGENT_WORKSPACE_LIMIT = 64;
// 回收覆盖历史 Base64url、Base62 与新生成的 Base36 目录，独立于身份读取约束。
const CHAT_DIRECTORY_PATTERN = /^[A-Za-z0-9_-]{8}$/u;

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
      const id = random_id();
      try {
        await this.fs.make_dir_exclusive(this.path(id));
        return id;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    }
  }

  /** 工程副本先获得新的材料目录，登记由工程事务提交。 */
  public async claim(id: string, projectPath: string, inUse: boolean): Promise<string> {
    const source = this.path(id);
    const ownerFile = ".project-path";
    const marker = path.join(source, ownerFile);
    const owner = this.fs.exists(marker) ? this.fs.read_text_file(marker) : undefined;
    const different =
      owner !== undefined &&
      this.fs.to_identity_path(owner) !== this.fs.to_identity_path(projectPath);
    if (!inUse && (!different || !this.fs.exists(owner!))) {
      if (owner !== projectPath) await this.fs.write_file(marker, projectPath);
      return id;
    }
    const copy = await this.create();
    try {
      if (this.fs.exists(source)) this.fs.copy_entry(source, this.path(copy));
      await this.fs.write_file(path.join(this.path(copy), ownerFile), projectPath);
      return copy;
    } catch (error) {
      await this.remove(copy);
      throw error;
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

  /** 保留所有打开工程的对话目录。回收按其余目录的最后使用时间排序。 */
  public async prune(protectedIds: ReadonlySet<string>): Promise<void> {
    try {
      const candidates = this.fs
        .read_dirents(this.root)
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            CHAT_DIRECTORY_PATTERN.test(entry.name) &&
            !protectedIds.has(entry.name),
        )
        .map((entry) => ({ id: entry.name, modified: this.fs.stat(this.path(entry.name)).mtimeMs }))
        .sort((left, right) => right.modified - left.modified || left.id.localeCompare(right.id));
      for (const entry of candidates.slice(Math.max(0, AGENT_WORKSPACE_LIMIT - protectedIds.size)))
        await this.remove(entry.id);
    } catch (error) {
      this.report(error);
    }
  }
}
