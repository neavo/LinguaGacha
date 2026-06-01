import type { ProjectDataRecord } from "../../project/project-data";

/**
 * PromptCache 保存 prompt meta block，避免页面查询反复读取数据库。
 */
export class PromptCache {
  private block: ProjectDataRecord = {}; // 只保存普通 JSON 快照，读取时再浅克隆。

  /**
   * before_read 由上层缓存管理器提供恢复钩子。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 整体替换 prompt block。
   */
  public replace(block: ProjectDataRecord): void {
    this.block = { ...block };
  }

  /**
   * 清空当前 prompt block。
   */
  public clear(): void {
    this.block = {};
  }

  /**
   * 返回 prompt block 浅克隆，隔离调用方写入。
   */
  public readBlock(): ProjectDataRecord {
    this.before_read();
    return { ...this.block };
  }
}
