import type { ProjectFileRecord } from "../project/project-file-records";

/**
 * FileCache 从 files block 提取稳定文件列表，供工作台和校对缓存复用。
 */
export class FileCache {
  private file_entries: ProjectFileRecord[] = []; // 文件顺序由 sort_index 或原始 block 顺序决定。

  /**
   * before_read 由 CacheManager 注入，用来在读取前尝试恢复缓存。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 用规范文件记录重建有序列表。
   */
  public replace(files_block: Record<string, ProjectFileRecord>): void {
    this.file_entries = Object.values(files_block)
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.sort_index - right.sort_index);
  }

  /**
   * 清空当前项目文件索引。
   */
  public clear(): void {
    this.file_entries = [];
  }

  /**
   * 返回文件条目克隆，避免调用方修改内部数组。
   */
  public readFileEntries(): ProjectFileRecord[] {
    this.before_read();
    return this.file_entries.map((entry) => ({ ...entry }));
  }
}
