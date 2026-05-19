import { normalize_project_item_public_record, type ProjectItemPublicRecord } from "@base/item";
import { InternalInvariantError } from "@shared/error";
import type { ProjectChangeItemsPayload } from "@shared/project/event";

/**
 * renderer 内共享的 item 只读索引；页面只能通过方法读取当前事实，不能把它当普通对象改写。
 */
export type ProjectItemIndex = {
  readonly size: number;
  /** 按公开 item_id 读取当前行，缺失时返回 undefined。 */
  get: (itemId: number | string) => ProjectItemPublicRecord | undefined;
  /** 判断当前索引是否仍持有指定 item。 */
  has: (itemId: number | string) => boolean;
  /** 遍历公开 item_id，主要用于测试和派生视图稳定排序。 */
  keys: () => IterableIterator<string>;
  /** 遍历当前公开 DTO，页面派生缓存从这里读取完整事实。 */
  values: () => IterableIterator<ProjectItemPublicRecord>;
  /** 遍历 item_id 与 DTO 对，供少数快照化边界使用。 */
  entries: () => IterableIterator<[string, ProjectItemPublicRecord]>;
  /** 显式物化对象快照，只允许测试或真实需要对象形状的边界调用。 */
  toRecordSnapshot: () => Record<string, ProjectItemPublicRecord>;
};

/**
 * ProjectItemIndex 的内部实现复用同一份 Map 存储，大项目高频 delta 不再复制完整 items。
 */
class MutableProjectItemIndex implements ProjectItemIndex {
  private readonly records: Map<string, ProjectItemPublicRecord>; // 唯一 item 存储，delta 路径只更新受影响 key

  /** 构造器只接收模块内部准备好的 Map，外部不能直接写入索引。 */
  public constructor(records: Map<string, ProjectItemPublicRecord>) {
    this.records = records;
  }

  /** 返回当前索引行数，避免调用方物化 keys 后计数。 */
  public get size(): number {
    return this.records.size;
  }

  /** 所有公开查询统一把数字和字符串 id 归一为同一个 key。 */
  public get(itemId: number | string): ProjectItemPublicRecord | undefined {
    return this.records.get(String(itemId));
  }

  /** tombstone 判断只依赖公开 item_id，不读取 DTO 内容。 */
  public has(itemId: number | string): boolean {
    return this.records.has(String(itemId));
  }

  /** key iterator 直接暴露 Map 迭代器，调用方不能借此写入内部记录。 */
  public keys(): IterableIterator<string> {
    return this.records.keys();
  }

  /** value iterator 供页面顺序扫描当前事实，不创建额外数组。 */
  public values(): IterableIterator<ProjectItemPublicRecord> {
    return this.records.values();
  }

  /** entry iterator 只用于显式快照化或 clone 边界。 */
  public entries(): IterableIterator<[string, ProjectItemPublicRecord]> {
    return this.records.entries();
  }

  /** 对象快照是有意的 O(N) 操作，避免热路径误把索引当普通 Record。 */
  public toRecordSnapshot(): Record<string, ProjectItemPublicRecord> {
    return Object.fromEntries(this.records.entries());
  }

  /** reset/测试 clone 需要真实分离 Map，避免后续 delta 污染旧边界。 */
  public cloneRecords(): Map<string, ProjectItemPublicRecord> {
    return new Map(this.records);
  }

  /** delta 热路径共享 Map 存储，由新包装器负责触发 React 依赖更新。 */
  public shareRecords(): Map<string, ProjectItemPublicRecord> {
    return this.records;
  }
}

function create_internal_invariant_error(reason: string): InternalInvariantError {
  return new InternalInvariantError({
    diagnostic_context: { section: "items", reason },
  });
}

function normalize_project_item_record(value: unknown): ProjectItemPublicRecord {
  const normalized_item = normalize_project_item_public_record(value);
  if (normalized_item === null) {
    throw create_internal_invariant_error("section_requires_full_item_dto_map");
  }
  return normalized_item;
}

function read_index_records(index: ProjectItemIndex): Map<string, ProjectItemPublicRecord> {
  if (index instanceof MutableProjectItemIndex) {
    return index.shareRecords();
  }
  return new Map(index.entries());
}

/**
 * 后端完整 section 快照进入 ProjectStore 时，必须一次性归一为 item_id 索引。
 */
export function createProjectItemIndex(
  value: Record<string, unknown> | undefined = {},
): ProjectItemIndex {
  const records = new Map<string, ProjectItemPublicRecord>();
  for (const item of Object.values(value)) {
    const normalized_item = normalize_project_item_record(item);
    records.set(String(normalized_item.item_id), normalized_item);
  }
  return new MutableProjectItemIndex(records);
}

/**
 * 复制索引用于 reset/初始化边界；普通 delta 路径不走这里，避免回到全量复制。
 */
export function cloneProjectItemIndex(index: ProjectItemIndex): ProjectItemIndex {
  if (index instanceof MutableProjectItemIndex) {
    return new MutableProjectItemIndex(index.cloneRecords());
  }
  return new MutableProjectItemIndex(new Map(index.entries()));
}

/**
 * canonical item delta 只触碰 upsert 与 tombstone 行，并返回新的索引包装器触发页面依赖更新。
 */
export function applyProjectItemIndexDelta(
  index: ProjectItemIndex,
  payload: ProjectChangeItemsPayload,
): ProjectItemIndex {
  if (payload.payloadMode !== "canonical-delta") {
    return index;
  }

  const records = read_index_records(index);
  let touched = false;

  for (const item of Object.values(payload.upsert ?? {})) {
    const normalized_item = normalize_project_item_record(item);
    records.set(String(normalized_item.item_id), normalized_item);
    touched = true;
  }

  for (const item_id of payload.deleteIds ?? []) {
    records.delete(String(item_id));
    touched = true;
  }

  return touched ? new MutableProjectItemIndex(records) : index;
}
