import type { QualityStatisticsDependencySnapshot } from "@shared/quality/quality-statistics";

// QUALITY_RULE_STATISTICS_RULE_TYPES 是共享统计调度支持的质量规则词表。
export const QUALITY_RULE_STATISTICS_RULE_TYPES = [
  "glossary",
  "pre_replacement",
  "post_replacement",
  "text_preserve",
] as const;

// QualityRuleStatisticsRuleType 是页面、调度器和 store 共享的质量统计规则窄化类型。
export type QualityRuleStatisticsRuleType = (typeof QUALITY_RULE_STATISTICS_RULE_TYPES)[number];

// phase 是质量统计缓存唯一的刷新状态源，避免 loose boolean 组合出现不可达中间态。
export type QualityRuleStatisticsCachePhase =
  | "empty"
  | "scheduled"
  | "running"
  | "current"
  | "failed";

export type QualityRuleStatisticsCacheSnapshot = {
  phase: QualityRuleStatisticsCachePhase; // phase 是页面刷新、排序可用性和前台补算的唯一判定入口。
  current_snapshot: QualityStatisticsDependencySnapshot | null; // current_snapshot 记录最近一次观察到的项目依赖快照。
  completed_snapshot: QualityStatisticsDependencySnapshot | null; // completed_snapshot 记录统计结果实际对应的依赖快照。
  completed_entry_ids: string[]; // completed_entry_ids 约束页面只展示当前完成快照内的条目结果。
  matched_count_by_entry_id: Record<string, number>; // matched_count_by_entry_id 是徽标命中数的派生结果表。
  subset_parent_labels_by_entry_id: Record<string, string[]>; // subset_parent_labels_by_entry_id 是子集关系徽标的派生结果表。
  last_error: Error | null; // last_error 只描述最近一次统计执行失败，不参与项目事实判断。
  request_token: number; // request_token 废弃迟到刷新结果，保证旧 in-flight 不能覆盖新缓存。
  updated_at: number | null; // updated_at 仅用于调试观察，不作为缓存新旧依据。
};

export type QualityRuleStatisticsStoreSnapshot = {
  project_path: string; // project_path 是缓存会话身份，切换项目必须整体 reset
  caches: Record<QualityRuleStatisticsRuleType, QualityRuleStatisticsCacheSnapshot>; // caches 按规则类型隔离统计结果
};

// QualityRuleStatisticsStoreListener 是 renderer 内存 store 的轻量订阅回调。
type QualityRuleStatisticsStoreListener = () => void;

export type QualityRuleStatisticsStore = {
  getSnapshot: () => QualityRuleStatisticsStoreSnapshot; // getSnapshot 暴露 renderer 派生缓存快照。
  subscribe: (listener: QualityRuleStatisticsStoreListener) => () => void; // subscribe 通知页面重读缓存。
  reset: (project_path: string) => void; // reset 切换项目并清空旧项目统计缓存。
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
 * 将缓存里按条目 id 拆分的统计结果还原为自动计划可消费的结果表。
 */
export function buildQualityRuleStatisticsResultMap(
  cache: QualityRuleStatisticsCacheSnapshot,
): Record<string, { matched_item_count: number; subset_parents: string[] }> {
  const entry_ids = new Set<string>([
    ...cache.completed_entry_ids,
    ...Object.keys(cache.matched_count_by_entry_id),
    ...Object.keys(cache.subset_parent_labels_by_entry_id),
  ]);

  return Object.fromEntries(
    [...entry_ids].map((entry_id) => {
      return [
        entry_id,
        {
          matched_item_count: cache.matched_count_by_entry_id[entry_id] ?? 0,
          subset_parents: cache.subset_parent_labels_by_entry_id[entry_id] ?? [],
        },
      ];
    }),
  );
}

/**
 * 统计任务或 noop/remap 计划完成后，统一用当前依赖快照提交 current 缓存。
 */
export function buildQualityRuleStatisticsCacheFromResults(args: {
  previous_cache: QualityRuleStatisticsCacheSnapshot;
  current_snapshot: QualityStatisticsDependencySnapshot;
  results: Record<string, { matched_item_count?: number; subset_parents?: string[] }>;
  request_token?: number;
}): QualityRuleStatisticsCacheSnapshot {
  return {
    ...args.previous_cache,
    phase: "current",
    current_snapshot: args.current_snapshot,
    completed_snapshot: args.current_snapshot,
    completed_entry_ids: args.current_snapshot.rules.map((rule) => {
      return rule.key;
    }),
    matched_count_by_entry_id: Object.fromEntries(
      Object.entries(args.results).map(([entry_id, result]) => {
        return [entry_id, result.matched_item_count ?? 0];
      }),
    ),
    subset_parent_labels_by_entry_id: Object.fromEntries(
      Object.entries(args.results).map(([entry_id, result]) => {
        return [entry_id, result.subset_parents ?? []];
      }),
    ),
    last_error: null,
    request_token: args.request_token ?? args.previous_cache.request_token,
    updated_at: Date.now(),
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
 * 创建 renderer 内存 store；同引用更新不广播，避免无语义刷新触发页面 effect。
 */
export function createQualityRuleStatisticsStore(): QualityRuleStatisticsStore {
  let snapshot = createEmptyQualityRuleStatisticsStoreSnapshot("");
  const listeners = new Set<QualityRuleStatisticsStoreListener>();

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
