import type { ProjectItemPublicRecord } from "../../domain/item";
import { build_project_item_duplicate_key } from "../../shared/project/project-item-duplicates";
import type { ProjectCommittedItems } from "../project/project-committed-change";

/**
 * ItemCache 维护按数据库顺序插入的 item 主索引。
 */
export class ItemCache {
  private items_by_id = new Map<number, ProjectItemPublicRecord>(); // 保留数据库主键顺序，读取时隔离顶层记录。
  private duplicate_groups: Map<string, number[]> | null = null; // 只保留真实重复组，结构变化后按需重建。

  /**
   * before_read 由 CacheManager 注入，用来在读取前恢复缓存。
   */
  public constructor(private readonly before_read: () => void = () => undefined) {}

  /**
   * 用完整 item 快照重建索引。
   */
  public replace(item_records: readonly ProjectItemPublicRecord[]): void {
    const next_items_by_id = new Map<number, ProjectItemPublicRecord>();
    for (const item of item_records) {
      next_items_by_id.set(item.item_id, { ...item });
    }
    this.items_by_id = next_items_by_id;
    this.duplicate_groups = null;
  }

  /**
   * 清空全部 item 索引。
   */
  public clear(): void {
    this.items_by_id.clear();
    this.duplicate_groups = null;
  }

  /**
   * 应用已提交的完整替换或规范行增量。
   */
  public applyChange(change: ProjectCommittedItems): void {
    if (change.mode === "full") {
      this.replace(change.records);
      return;
    }

    for (const record of change.records) this.upsert_item(record);
  }

  /** 显式目标总是保留，同组只补入会参与重复协调的成员。 */
  public readWriteScope(item_ids: readonly number[]): number[] {
    this.before_read();
    if (this.duplicate_groups === null) {
      const groups = new Map<string, number[]>();
      for (const item of this.items_by_id.values()) {
        const key = build_project_item_duplicate_key(item);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [item.item_id]);
        else group.push(item.item_id);
      }
      for (const [key, members] of groups) if (members.length < 2) groups.delete(key);
      this.duplicate_groups = groups;
    }
    const ids = new Set(item_ids);
    const visited = new Set<string>();
    for (const id of item_ids) {
      const item = this.items_by_id.get(id);
      if (item === undefined) continue;
      const key = build_project_item_duplicate_key(item);
      if (visited.has(key)) continue;
      visited.add(key);
      for (const member of this.duplicate_groups.get(key) ?? []) {
        const status = this.items_by_id.get(member)?.status;
        if (
          status === "NONE" ||
          status === "DUPLICATED" ||
          status === "PROCESSED" ||
          status === "ERROR"
        )
          ids.add(member);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  /**
   * 读取全部 item，返回浅克隆数组。
   */
  public readItems(): ProjectItemPublicRecord[] {
    this.before_read();
    return Array.from(this.items_by_id.values(), (item) => ({ ...item }));
  }

  /** 文件索引只需要路径与格式，重排文件时无需复制正文。 */
  public readFileMetadata(): Pick<ProjectItemPublicRecord, "file_path" | "file_type">[] {
    this.before_read();
    const files = new Map<string, Pick<ProjectItemPublicRecord, "file_path" | "file_type">>();
    for (const item of this.items_by_id.values()) {
      if (
        item.file_path !== "" &&
        (!files.has(item.file_path) || files.get(item.file_path)?.file_type === "NONE")
      ) {
        files.set(item.file_path, { file_path: item.file_path, file_type: item.file_type });
      }
    }
    return [...files.values()];
  }

  /**
   * 按 item_id 读取单条记录，未命中返回 null。
   */
  public readItem(item_id: number): ProjectItemPublicRecord | null {
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
  private upsert_item(item: ProjectItemPublicRecord): void {
    const previous = this.items_by_id.get(item.item_id);
    if (
      previous === undefined ||
      build_project_item_duplicate_key(previous) !== build_project_item_duplicate_key(item)
    )
      this.duplicate_groups = null;
    this.items_by_id.set(item.item_id, { ...item });
  }
}
