import type { ProjectDataRecord } from "../../project/project-data";
import type { CacheItemChange } from "../cache-change";
import type { CacheItem } from "../cache-types";

/**
 * ItemCache 维护按数据库顺序插入的 item 主索引。
 */
export class ItemCache {
  private items_by_id = new Map<number, CacheItem>();

  /**
   * before_read 由 CacheManager 注入，用来在读取前恢复缓存。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 用完整 item 快照重建索引。
   */
  public replace(item_records: ProjectDataRecord[]): void {
    const next_items_by_id = new Map<number, CacheItem>();
    for (const item of item_records) {
      const item_id = this.read_number(item["item_id"], 0);
      if (item_id <= 0) {
        continue;
      }
      next_items_by_id.set(item_id, { ...item });
    }
    this.items_by_id = next_items_by_id;
  }

  /**
   * 清空全部 item 索引。
   */
  public clear(): void {
    this.items_by_id.clear();
  }

  /**
   * 应用事件中的 item 变化，支持全量替换、字段 patch 和完整行 upsert。
   */
  public applyChange(change: CacheItemChange, upsert_records: ProjectDataRecord[]): void {
    if (change.mode === "keep") {
      return;
    }
    if (change.mode === "full") {
      this.replace(upsert_records);
      return;
    }

    const delete_ids = new Set(change.deleteIds);
    for (const item_id of delete_ids) {
      this.items_by_id.delete(item_id);
    }

    if (change.fieldPatch !== null) {
      for (const item_id of change.changedIds) {
        if (delete_ids.has(item_id)) {
          continue;
        }
        const current = this.items_by_id.get(item_id);
        if (current !== undefined) {
          this.upsert_item({ ...current, ...change.fieldPatch });
        }
      }
    }

    for (const record of upsert_records) {
      const item_id = this.read_number(record["item_id"] ?? record["id"], 0);
      if (delete_ids.has(item_id)) {
        continue;
      }
      this.upsert_item(record);
    }
  }

  /**
   * 读取全部 item，返回浅克隆数组。
   */
  public readItems(): CacheItem[] {
    this.before_read();
    return Array.from(this.items_by_id.values(), (item) => ({ ...item }));
  }

  /**
   * 按 item_id 读取单条记录，未命中返回 null。
   */
  public readItem(item_id: number): CacheItem | null {
    this.before_read();
    const item = this.items_by_id.get(item_id);
    return item === undefined ? null : { ...item };
  }

  /**
   * 返回当前缓存中有效 item 数量。
   */
  public size(): number {
    return this.items_by_id.size;
  }

  /**
   * 写入单条 item；Map 更新既有键时保持顺序，新键追加到末尾。
   */
  private upsert_item(item: ProjectDataRecord): void {
    const item_id = this.read_number(item["item_id"] ?? item["id"], 0);
    if (item_id <= 0) {
      return;
    }
    this.items_by_id.set(item_id, { ...item, item_id });
  }

  /**
   * 读取数据库数字字段，非法值回退到调用方默认值。
   */
  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
}
