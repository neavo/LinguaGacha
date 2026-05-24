import { normalize_project_item_public_record, type ProjectItemPublicRecord } from "@base/item";
import { InternalInvariantError } from "@shared/error";
import type { ProjectChangeItemFieldPatch, ProjectChangeItemsPayload } from "@shared/project/event";

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
 * ProjectStore 批量 prepare 的 item 写作用域；作用域内 Map 不暴露给页面。
 */
export type ProjectItemIndexWriteScope = {
  records: Map<string, ProjectItemPublicRecord>; // draft records 是批量 prepare 阶段唯一可写副本
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
}

// create_internal_invariant_error 构造跨层载荷，保证字段形状在一个入口维护。
function create_internal_invariant_error(reason: string): InternalInvariantError {
  return new InternalInvariantError({
    diagnostic_context: { section: "items", reason },
  });
}

// normalize_project_item_record 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_project_item_record(value: unknown): ProjectItemPublicRecord {
  const normalized_item = normalize_project_item_public_record(value);
  if (normalized_item === null) {
    throw create_internal_invariant_error("section_requires_full_item_dto_map");
  }
  return normalized_item;
}

// clone_index_records 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function clone_index_records(index: ProjectItemIndex): Map<string, ProjectItemPublicRecord> {
  if (index instanceof MutableProjectItemIndex) {
    return index.cloneRecords();
  }
  return new Map(index.entries());
}

/**
 * 为批量 ProjectStore prepare 创建一次 item 副本，后续 delta 都写入这份 draft。
 */
export function createProjectItemIndexWriteScope(
  index: ProjectItemIndex,
): ProjectItemIndexWriteScope {
  return {
    records: clone_index_records(index),
  };
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

// apply_item_field_patch 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function apply_item_field_patch(
  item: ProjectItemPublicRecord,
  patch: ProjectChangeItemFieldPatch | undefined,
): ProjectItemPublicRecord | null {
  if (patch === undefined) {
    return null;
  }
  const next_item: ProjectItemPublicRecord = { ...item };
  let touched = false;
  if (typeof patch.dst === "string" && patch.dst !== item.dst) {
    next_item.dst = patch.dst;
    touched = true;
  }
  if (patch.status !== undefined && patch.status !== item.status) {
    next_item.status = patch.status;
    touched = true;
  }
  if (typeof patch.retry_count === "number" && patch.retry_count !== item.retry_count) {
    next_item.retry_count = patch.retry_count;
    touched = true;
  }
  return touched ? next_item : null;
}

/**
 * item 行级变更先写入调用方传入的 draft，原索引只在调用方提交新包装器后才可见。
 */
export function applyProjectItemIndexChangeInScope(
  currentIndex: ProjectItemIndex,
  scope: ProjectItemIndexWriteScope,
  payload: ProjectChangeItemsPayload,
): ProjectItemIndex {
  const records = scope.records;
  let touched = false;

  if (payload.payloadMode === "canonical-delta") {
    for (const item of Object.values(payload.upsert ?? {})) {
      const normalized_item = normalize_project_item_record(item);
      records.set(String(normalized_item.item_id), normalized_item);
      touched = true;
    }
  }

  if (payload.payloadMode === "field-patch") {
    for (const item_id of payload.changedIds ?? []) {
      const key = String(item_id);
      const current_item = records.get(key);
      if (current_item === undefined) {
        continue;
      }
      const patched_item = apply_item_field_patch(current_item, payload.fieldPatch);
      if (patched_item === null) {
        continue;
      }
      records.set(key, patched_item);
      touched = true;
    }
  }

  for (const item_id of payload.deleteIds ?? []) {
    const key = String(item_id);
    if (records.delete(key)) {
      touched = true;
    }
  }

  return touched ? new MutableProjectItemIndex(records) : currentIndex;
}

/**
 * 单条 delta 也走 prepare 副本，校验失败时不会污染传入索引。
 */
export function applyProjectItemIndexChange(
  index: ProjectItemIndex,
  payload: ProjectChangeItemsPayload,
): ProjectItemIndex {
  const scope = createProjectItemIndexWriteScope(index);
  return applyProjectItemIndexChangeInScope(index, scope, payload);
}
