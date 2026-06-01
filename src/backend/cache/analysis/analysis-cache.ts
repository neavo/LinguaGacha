import type { ProjectDataRecord } from "../../project/project-data";

/**
 * AnalysisCache 保存 analysis meta 的轻量快照，供 query 侧读取缓存事实。
 */
export class AnalysisCache {
  private block: ProjectDataRecord = {}; // 始终以浅克隆形式对外暴露，避免调用方改写缓存。

  /**
   * before_read 由 CacheManager 注入，用于读取前尝试恢复 recoverable error。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 用数据库读取结果整体替换 analysis block。
   */
  public replace(block: ProjectDataRecord): void {
    this.block = { ...block };
  }

  /**
   * 清空当前项目的 analysis block。
   */
  public clear(): void {
    this.block = {};
  }

  /**
   * 读取 analysis block 的浅克隆，调用方不能持有内部引用。
   */
  public readBlock(): ProjectDataRecord {
    this.before_read();
    return { ...this.block };
  }
}
