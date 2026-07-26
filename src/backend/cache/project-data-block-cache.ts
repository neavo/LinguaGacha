import type { ProjectDataRecord } from "../project/project-data";

/**
 * 保存单个项目小型数据块；只隔离顶层对象，嵌套 JSON 按不可变值使用。
 */
export class ProjectDataBlockCache {
  private block: ProjectDataRecord = {}; // 当前块的顶层快照

  /**
   * before_read 用于 CacheManager 在读取前确认会话缓存已热机。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 用新的顶层快照整体替换数据块。
   */
  public replace(block: ProjectDataRecord): void {
    this.block = { ...block };
  }

  /**
   * 丢弃当前块，不保留上一项目的数据引用。
   */
  public clear(): void {
    this.block = {};
  }

  /**
   * 确认缓存可读后返回独立的顶层对象。
   */
  public readBlock(): ProjectDataRecord {
    this.before_read();
    return { ...this.block };
  }
}
