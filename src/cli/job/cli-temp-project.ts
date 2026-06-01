import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * CLITempProject 管理 CLI 内部临时 .lg 工程目录，避免把项目文件心智暴露给用户。
 */
export class CLITempProject {
  public readonly rootDir: string; // 临时工程和中间文件的唯一容器
  public readonly projectPath: string; // 只供 Backend 服务加载和任务执行使用

  private constructor(root_dir: string) {
    this.rootDir = root_dir;
    this.projectPath = path.join(root_dir, "cli-job.lg");
  }

  /**
   * 创建新的临时工程目录；每次 CLI job 独占，避免跨任务状态残留。
   */
  public static async create(): Promise<CLITempProject> {
    const root_dir = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-cli-"));
    return new CLITempProject(root_dir);
  }

  /**
   * 清理临时工程目录；失败时让调用方决定是否上报。
   */
  public async cleanup(): Promise<void> {
    await fs.rm(this.rootDir, { recursive: true, force: true });
  }
}
