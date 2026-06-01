import type { ProjectDataRecord } from "../../project/project-data";
import type { CacheItemChange } from "../cache-change";
import type { CacheItem } from "../cache-types";

/**
 * ItemCache 维护 item 主索引、读取顺序和文件反向索引。
 */
export class ItemCache {
  private items_by_id = new Map<number, CacheItem>(); // item_id 到普通记录的主索引。
  private item_order: number[] = []; // 全量读取保持数据库快照顺序。
  private file_index = new Map<string, number[]>(); // 文件路径到 item_id 列表的快速索引。

  /**
   * before_read 由 CacheManager 注入，用来在读取前恢复缓存。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 用完整 item 快照重建全部索引。
   */
  public replace(item_records: ProjectDataRecord[]): void {
    const next_items_by_id = new Map<number, CacheItem>();
    const next_item_order: number[] = [];
    const next_file_index = new Map<string, number[]>();
    for (const item of item_records) {
      const item_id = this.read_number(item["item_id"], 0);
      if (item_id <= 0) {
        continue;
      }
      next_items_by_id.set(item_id, { ...item });
      next_item_order.push(item_id);
      const file_path = String(item["file_path"] ?? "");
      if (file_path !== "") {
        const ids = next_file_index.get(file_path) ?? [];
        ids.push(item_id);
        next_file_index.set(file_path, ids);
      }
    }
    this.items_by_id = next_items_by_id;
    this.item_order = next_item_order;
    this.file_index = next_file_index;
  }

  /**
   * 清空全部 item 索引。
   */
  public clear(): void {
    this.items_by_id = new Map();
    this.item_order = [];
    this.file_index = new Map();
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
      this.delete_item(item_id);
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
   * 读取全部 item 或指定文件下的 item，返回浅克隆数组。
   */
  public readItems(query: { filePath?: string } = {}): CacheItem[] {
    this.before_read();
    const ids =
      query.filePath === undefined ? this.item_order : (this.file_index.get(query.filePath) ?? []);
    return ids
      .map((item_id) => this.items_by_id.get(item_id))
      .filter((item): item is CacheItem => item !== undefined)
      .map((item) => ({ ...item }));
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
   * 写入单条 item 并在文件路径变化时修复反向索引。
   */
  private upsert_item(item: ProjectDataRecord): void {
    const item_id = this.read_number(item["item_id"] ?? item["id"], 0);
    if (item_id <= 0) {
      return;
    }
    const previous = this.items_by_id.get(item_id);
    const previous_file_path = previous === undefined ? "" : String(previous["file_path"] ?? "");
    if (previous === undefined) {
      this.item_order.push(item_id);
    }
    const next_item: CacheItem = { ...item, item_id };
    const next_file_path = String(next_item["file_path"] ?? "");
    this.items_by_id.set(item_id, next_item);
    if (previous === undefined) {
      this.add_to_file_index(item_id, next_file_path);
      return;
    }
    if (previous_file_path !== next_file_path) {
      this.rebuild_file_index(previous_file_path);
      this.rebuild_file_index(next_file_path);
    }
  }

  /**
   * 删除 item 时同步移除全局顺序和文件索引。
   */
  private delete_item(item_id: number): void {
    const previous = this.items_by_id.get(item_id);
    if (previous === undefined) {
      return;
    }
    this.remove_from_file_index(item_id, String(previous["file_path"] ?? ""));
    this.items_by_id.delete(item_id);
    this.item_order = this.item_order.filter((current_id) => current_id !== item_id);
  }

  /**
   * 将 item_id 添加到指定文件路径的索引尾部。
   */
  private add_to_file_index(item_id: number, file_path: string): void {
    if (file_path === "") {
      return;
    }
    const ids = this.file_index.get(file_path) ?? [];
    if (!ids.includes(item_id)) {
      ids.push(item_id);
    }
    this.file_index.set(file_path, ids);
  }

  /**
   * 从指定文件路径索引中移除 item_id，空索引直接删除。
   */
  private remove_from_file_index(item_id: number, file_path: string): void {
    if (file_path === "") {
      return;
    }
    const ids = this.file_index.get(file_path);
    if (ids === undefined) {
      return;
    }
    const next_ids = ids.filter((current_id) => current_id !== item_id);
    if (next_ids.length === 0) {
      this.file_index.delete(file_path);
      return;
    }
    this.file_index.set(file_path, next_ids);
  }

  /**
   * 按当前 item_order 重建单个文件路径索引。
   */
  private rebuild_file_index(file_path: string): void {
    if (file_path === "") {
      return;
    }
    const next_ids = this.item_order.filter((item_id) => {
      const item = this.items_by_id.get(item_id);
      return item !== undefined && String(item["file_path"] ?? "") === file_path;
    });
    if (next_ids.length === 0) {
      this.file_index.delete(file_path);
      return;
    }
    this.file_index.set(file_path, next_ids);
  }

  /**
   * 读取数据库数字字段，非法值回退到调用方默认值。
   */
  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
}
