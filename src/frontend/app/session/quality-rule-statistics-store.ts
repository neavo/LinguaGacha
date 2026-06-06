import {
  QUALITY_STATISTICS_RULE_MODES,
  type QualityStatisticsDependencySnapshot,
} from "@shared/quality/quality-statistics";
import {
  resolve_quality_statistics_item_text_change_scope,
  type QualityStatisticsTextChangeScope,
} from "@shared/quality/quality-statistics-invalidation";
import type { ProjectChangeItemFieldPatch, ProjectDataSection } from "@shared/project-event";

// 渲染进程统计调度消费的共享规则词表别名。
export const QUALITY_RULE_STATISTICS_RULE_TYPES = QUALITY_STATISTICS_RULE_MODES;

// 页面、调度器和 store 共享的质量统计规则窄化类型。
export type QualityRuleStatisticsRuleType = (typeof QUALITY_RULE_STATISTICS_RULE_TYPES)[number];

// phase 是质量统计缓存唯一的刷新状态源，避免 loose boolean 组合出现不可达中间态。
export type QualityRuleStatisticsCachePhase =
  | "empty"
  | "scheduled"
  | "running"
  | "current"
  | "failed";

export type QualityRuleStatisticsCacheSnapshot = {
  phase: QualityRuleStatisticsCachePhase; // 页面刷新、排序可用性和前台补算的唯一判定入口。
  current_snapshot: QualityStatisticsDependencySnapshot | null; // 记录最近一次观察到的项目依赖快照。
  completed_snapshot: QualityStatisticsDependencySnapshot | null; // 记录统计结果实际对应的依赖快照。
  completed_entry_ids: string[]; // 约束页面只展示当前完成快照内的条目结果。
  matched_count_by_entry_id: Record<string, number>; // 徽标命中数的计算结果表。
  subset_parent_labels_by_entry_id: Record<string, string[]>; // 子集关系徽标的计算结果表。
  last_error: Error | null; // 只描述最近一次统计执行失败，不参与项目事实判断。
  request_token: number; // 废弃迟到刷新结果，保证旧 in-flight 不能覆盖新缓存。
  updated_at: number | null; // 仅用于调试观察，不作为缓存新旧依据。
};

export type QualityRuleStatisticsStoreSnapshot = {
  project_path: string; // 缓存会话身份，切换项目必须整体 reset
  caches: Record<QualityRuleStatisticsRuleType, QualityRuleStatisticsCacheSnapshot>; // 按规则类型隔离统计结果
};

export type QualityRuleStatisticsProjectChangeSignal = {
  seq: number; // 初始空信号不触发统计失效。
  updated_sections: readonly ProjectDataSection[]; // 顶层 section 决定是否需要进入质量统计判定。
  results: readonly {
    source: string; // 后端写入来源用于识别翻译批次和重翻批次。
    updatedSections: readonly ProjectDataSection[]; // 单个写入结果的真实影响范围。
    itemDelta?: {
      upsertItemIds: ReadonlyArray<number | string>; // 只用于判断是否存在 item 变化，不进入统计身份。
      deleteItemIds: ReadonlyArray<number | string>; // 删除会改变原文类统计覆盖范围。
      fullReplace: boolean; // 全量替换无法证明文本源范围。
      fieldPatch?: ProjectChangeItemFieldPatch; // 字段补丁是精确区分原文/译文影响的唯一证据。
    };
  }[];
};

// 渲染进程内存 store 的轻量订阅回调。
type QualityRuleStatisticsStoreListener = () => void;

export type QualityRuleStatisticsStore = {
  getSnapshot: () => QualityRuleStatisticsStoreSnapshot; // 暴露渲染进程计算缓存快照。
  subscribe: (listener: QualityRuleStatisticsStoreListener) => () => void; // 通知页面重读缓存。
  reset: (project_path: string) => void; // 切换项目并清空旧项目统计缓存。
  updateCache: (
    rule_type: QualityRuleStatisticsRuleType,
    updater: (cache: QualityRuleStatisticsCacheSnapshot) => QualityRuleStatisticsCacheSnapshot,
  ) => void; // updateCache 是单个规则缓存的唯一写入口。
};

/**
 * 创建尚未计算过的缓存；页面只会从这个阶段发起前台补算。
 */
export function createEmptyQualityRuleStatisticsCacheSnapshot(): QualityRuleStatisticsCacheSnapshot {
  return {
    phase: "empty",
    current_snapshot: null,
    completed_snapshot: null,
    completed_entry_ids: [],
    matched_count_by_entry_id: {},
    subset_parent_labels_by_entry_id: {},
    last_error: null,
    request_token: 0,
    updated_at: null,
  };
}

/**
 * 页面排序和徽标只能把 current 当成当前项目事实对应的统计结果。
 */
export function isQualityRuleStatisticsCacheReady(
  cache: QualityRuleStatisticsCacheSnapshot,
): boolean {
  return cache.phase === "current";
}

/**
 * running 只表示统计正在计算；scheduled 仍可继续展示旧结果。
 */
export function isQualityRuleStatisticsCacheRunning(
  cache: QualityRuleStatisticsCacheSnapshot,
): boolean {
  return cache.phase === "running";
}

/**
 * 前台刷新只由已挂载页面触发；失败态必须等待显式重试或依赖变化，避免 effect 无限重试。
 */
export function shouldRequestQualityRuleStatisticsForeground(
  cache: QualityRuleStatisticsCacheSnapshot,
): boolean {
  return cache.phase === "empty" || cache.phase === "scheduled";
}

/**
 * 把项目变更信号折叠成需要失效的规则集合，Provider 只消费这个单一判定入口。
 */
export function resolveQualityRuleStatisticsRulesToExpire(
  signal: QualityRuleStatisticsProjectChangeSignal,
): QualityRuleStatisticsRuleType[] {
  if (signal.seq === 0) {
    return [];
  }
  if (signal.updated_sections.includes("quality")) {
    return [...QUALITY_RULE_STATISTICS_RULE_TYPES];
  }
  if (!signal.updated_sections.includes("items")) {
    return [];
  }

  // 合并窗口里可能混入其它 section，只让真实 item 结果参与文本源判定。
  const item_results = signal.results.filter((result) => {
    return result.updatedSections.includes("items") || result.itemDelta !== undefined;
  });
  if (item_results.length === 0) {
    return [...QUALITY_RULE_STATISTICS_RULE_TYPES];
  }

  // 多个 item result 混合时，任一全量风险立即扩大到全部规则。
  let should_expire_post_replacement = false;
  for (const result of item_results) {
    const scope = resolve_quality_statistics_item_result_expire_scope(result);
    if (scope === "all") {
      return [...QUALITY_RULE_STATISTICS_RULE_TYPES];
    }
    if (scope === "post_replacement") {
      should_expire_post_replacement = true;
    }
  }

  return should_expire_post_replacement ? ["post_replacement"] : [];
}

/**
 * 单个写入结果只负责判定文本源影响范围，最终规则集合由外层合并。
 */
function resolve_quality_statistics_item_result_expire_scope(
  result: QualityRuleStatisticsProjectChangeSignal["results"][number],
): QualityStatisticsTextChangeScope {
  const item_delta = result.itemDelta;
  if (item_delta === undefined) {
    return "all";
  }
  return resolve_quality_statistics_item_text_change_scope({
    source: result.source,
    fullReplace: item_delta.fullReplace,
    deleteCount: item_delta.deleteItemIds.length,
    fieldPatch: item_delta.fieldPatch,
  });
}

/**
 * 创建项目级统计 store 初始快照，四类规则必须共享同一 phase 结构。
 */
function createEmptyQualityRuleStatisticsStoreSnapshot(
  project_path: string,
): QualityRuleStatisticsStoreSnapshot {
  return {
    project_path,
    caches: {
      glossary: createEmptyQualityRuleStatisticsCacheSnapshot(),
      pre_replacement: createEmptyQualityRuleStatisticsCacheSnapshot(),
      post_replacement: createEmptyQualityRuleStatisticsCacheSnapshot(),
      text_preserve: createEmptyQualityRuleStatisticsCacheSnapshot(),
    },
  };
}

/**
 * 未挂载页面对应的统计缓存失效时只清空结果，不安排后台计算。
 */
export function expireQualityRuleStatisticsCache(
  cache: QualityRuleStatisticsCacheSnapshot,
): QualityRuleStatisticsCacheSnapshot {
  if (cache.phase === "empty") {
    return cache;
  }

  return {
    ...createEmptyQualityRuleStatisticsCacheSnapshot(),
    request_token: cache.request_token + 1,
    updated_at: Date.now(),
  };
}

/**
 * 创建渲染进程内存 store；同引用更新不广播，避免无语义刷新触发页面 effect。
 */
export function createQualityRuleStatisticsStore(): QualityRuleStatisticsStore {
  // snapshot 是渲染进程内存事实，所有页面订阅都从这里读取同一份缓存。
  let snapshot = createEmptyQualityRuleStatisticsStoreSnapshot("");
  // listeners 只保存轻量回调，避免页面状态进入共享 store。
  const listeners = new Set<QualityRuleStatisticsStoreListener>();

  // 统一广播入口，保证所有写路径都经过同一批订阅者。
  function emit_change(): void {
    listeners.forEach((listener) => {
      listener();
    });
  }

  return {
    getSnapshot(): QualityRuleStatisticsStoreSnapshot {
      return snapshot;
    },
    subscribe(listener: QualityRuleStatisticsStoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(project_path: string): void {
      snapshot = createEmptyQualityRuleStatisticsStoreSnapshot(project_path);
      emit_change();
    },
    updateCache(
      rule_type: QualityRuleStatisticsRuleType,
      updater: (cache: QualityRuleStatisticsCacheSnapshot) => QualityRuleStatisticsCacheSnapshot,
    ): void {
      const previous_cache = snapshot.caches[rule_type];
      const next_cache = updater(previous_cache);
      if (next_cache === previous_cache) {
        return;
      }

      snapshot = {
        ...snapshot,
        caches: {
          ...snapshot.caches,
          [rule_type]: next_cache,
        },
      };
      emit_change();
    },
  };
}
