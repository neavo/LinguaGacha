import type { ProjectDataRecord } from "../../project/project-data";
import type { CacheItemChange } from "../cache-change";
import type { CacheItem } from "../cache-types";

export class ItemCache {
  private items_by_id = new Map<number, CacheItem>();
  private item_order: number[] = [];
  private file_index = new Map<string, number[]>();

  public constructor(private readonly before_read: () => void = () => undefined) {}

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

  public clear(): void {
    this.items_by_id = new Map();
    this.item_order = [];
    this.file_index = new Map();
  }

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

  public readItems(query: { filePath?: string } = {}): CacheItem[] {
    this.before_read();
    const ids =
      query.filePath === undefined ? this.item_order : (this.file_index.get(query.filePath) ?? []);
    return ids
      .map((item_id) => this.items_by_id.get(item_id))
      .filter((item): item is CacheItem => item !== undefined)
      .map((item) => ({ ...item }));
  }

  public readItem(item_id: number): CacheItem | null {
    this.before_read();
    const item = this.items_by_id.get(item_id);
    return item === undefined ? null : { ...item };
  }

  public size(): number {
    return this.items_by_id.size;
  }

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

  private delete_item(item_id: number): void {
    const previous = this.items_by_id.get(item_id);
    if (previous === undefined) {
      return;
    }
    this.remove_from_file_index(item_id, String(previous["file_path"] ?? ""));
    this.items_by_id.delete(item_id);
    this.item_order = this.item_order.filter((current_id) => current_id !== item_id);
  }

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

  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
}
