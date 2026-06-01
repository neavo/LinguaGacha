import type { ProjectDataRecord } from "../../project/project-data";

/**
 * QualityCache 保存质量规则 block，供校对和统计缓存共享读取。
 */
export class QualityCache {
  private block: ProjectDataRecord = {}; // 质量规则以 meta block 形式保存，读取时复制外发。

  /**
   * before_read 负责在读取前触发 CacheManager 的错误恢复流程。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 整体替换质量规则 block。
   */
  public replace(block: ProjectDataRecord): void {
    this.block = { ...block };
  }

  /**
   * 清空当前质量规则 block。
   */
  public clear(): void {
    this.block = {};
  }

  /**
   * 返回质量规则 block 浅克隆。
   */
  public readBlock(): ProjectDataRecord {
    this.before_read();
    return { ...this.block };
  }

  /**
   * 质量检查结果仍由独立服务生成；当前缓存只提供稳定空壳。
   */
  public readQualityCheck(item_id: number): ProjectDataRecord {
    this.before_read();
    return {
      item_id,
      warnings: [],
      warning_fragments_by_code: {},
    };
  }
}
