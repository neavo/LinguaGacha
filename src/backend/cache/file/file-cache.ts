import type { ProjectDataRecord } from "../../project/project-data";
import type { CacheFileEntry } from "../cache-types";

/**
 * FileCache 从 files block 提取稳定文件列表，供工作台和校对缓存复用。
 */
export class FileCache {
  private file_entries: CacheFileEntry[] = []; // 文件顺序由 sort_index 或原始 block 顺序决定。

  /**
   * before_read 由 CacheManager 注入，用来在读取前尝试恢复缓存。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 用 files block 重建文件条目，过滤缺少相对路径的无效记录。
   */
  public replace(files_block: ProjectDataRecord): void {
    this.file_entries = Object.values(files_block).flatMap((value, index) => {
      if (!this.is_record(value)) {
        return [];
      }
      const rel_path = String(value["rel_path"] ?? "").trim();
      if (rel_path === "") {
        return [];
      }
      return [
        {
          rel_path,
          file_type: String(value["file_type"] ?? "NONE"),
          sort_index: this.read_number(value["sort_index"], index),
        },
      ];
    });
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
  public readFileEntries(): CacheFileEntry[] {
    this.before_read();
    return this.file_entries.map((entry) => ({ ...entry }));
  }

  /**
   * 判断数据库 JSON 值是否为普通记录。
   */
  private is_record(value: unknown): value is ProjectDataRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 读取数字字段，非法值回退到调用方给出的稳定序号。
   */
  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
}
