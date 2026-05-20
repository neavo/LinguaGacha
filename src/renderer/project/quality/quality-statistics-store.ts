import type { QualityStatisticsDependencySnapshot } from "@/project/quality/quality-statistics-auto";

export const QUALITY_STATISTICS_RULE_TYPES = [
  "glossary",
  "pre_replacement",
  "post_replacement",
  "text_preserve",
] as const;

export type QualityStatisticsRuleType = (typeof QUALITY_STATISTICS_RULE_TYPES)[number];

// phase 是质量统计缓存唯一的刷新状态源，避免 loose boolean 组合出现不可达中间态。
export type QualityStatisticsCachePhase = "empty" | "scheduled" | "running" | "current" | "failed";

export type QualityStatisticsCacheSnapshot = {
  phase: QualityStatisticsCachePhase; // phase 是页面刷新、排序可用性和前台补算的唯一判定入口。
  current_snapshot: QualityStatisticsDependencySnapshot | null; // current_snapshot 记录最近一次观察到的项目依赖快照。
  completed_snapshot: QualityStatisticsDependencySnapshot | null; // completed_snapshot 记录统计结果实际对应的依赖快照。
  completed_entry_ids: string[]; // completed_entry_ids 约束页面只展示当前完成快照内的条目结果。
  matched_count_by_entry_id: Record<string, number>; // matched_count_by_entry_id 是徽标命中数的派生结果表。
  subset_parent_labels_by_entry_id: Record<string, string[]>; // subset_parent_labels_by_entry_id 是子集关系徽标的派生结果表。
  last_error: Error | null; // last_error 只描述最近一次 worker 执行失败，不参与项目事实判断。
  request_token: number; // request_token 废弃迟到刷新结果，保证旧 in-flight 不能覆盖新缓存。
  updated_at: number | null; // updated_at 仅用于调试观察，不作为缓存新旧依据。
};

export type QualityStatisticsStoreSnapshot = {
  project_path: string;
  caches: Record<QualityStatisticsRuleType, QualityStatisticsCacheSnapshot>;
};

type QualityStatisticsStoreListener = () => void;

export type QualityStatisticsStore = {
  getSnapshot: () => QualityStatisticsStoreSnapshot; // getSnapshot 暴露 renderer 派生缓存快照。
  subscribe: (listener: QualityStatisticsStoreListener) => () => void; // subscribe 通知页面重读缓存。
  reset: (project_path: string) => void; // reset 切换项目并清空旧项目统计缓存。
  updateCache: (
    rule_type: QualityStatisticsRuleType,
    updater: (cache: QualityStatisticsCacheSnapshot) => QualityStatisticsCacheSnapshot,
  ) => void; // updateCache 是单个规则缓存的唯一写入口。
};

/**
 * 创建尚未计算过的缓存；页面只会从这个阶段发起前台补算。
 */
export function createEmptyQualityStatisticsCacheSnapshot(): QualityStatisticsCacheSnapshot {
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
export function isQualityStatisticsCacheReady(cache: QualityStatisticsCacheSnapshot): boolean {
  return cache.phase === "current";
}

/**
 * running 只表示 worker 正在计算；scheduled 仍可继续展示旧结果。
 */
export function isQualityStatisticsCacheRunning(cache: QualityStatisticsCacheSnapshot): boolean {
  return cache.phase === "running";
}

/**
 * 前台刷新只补齐从未计算过的空缓存，避免 scheduled/noop/remap 阶段自激重调度。
 */
export function shouldRequestQualityStatisticsForeground(
  cache: QualityStatisticsCacheSnapshot,
): boolean {
  return cache.phase === "empty";
}

function createEmptyQualityStatisticsStoreSnapshot(
  project_path: string,
): QualityStatisticsStoreSnapshot {
  return {
    project_path,
    caches: {
      glossary: createEmptyQualityStatisticsCacheSnapshot(),
      pre_replacement: createEmptyQualityStatisticsCacheSnapshot(),
      post_replacement: createEmptyQualityStatisticsCacheSnapshot(),
      text_preserve: createEmptyQualityStatisticsCacheSnapshot(),
    },
  };
}

/**
 * 将缓存里按条目 id 拆分的统计结果还原为自动计划可消费的结果表。
 */
export function buildQualityStatisticsResultMap(
  cache: QualityStatisticsCacheSnapshot,
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
export function buildQualityStatisticsCacheFromResults(args: {
  previous_cache: QualityStatisticsCacheSnapshot;
  current_snapshot: QualityStatisticsDependencySnapshot;
  results: Record<string, { matched_item_count?: number; subset_parents?: string[] }>;
  request_token?: number;
}): QualityStatisticsCacheSnapshot {
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
 * 创建 renderer 内存 store；同引用更新不广播，避免无语义刷新触发页面 effect。
 */
export function createQualityStatisticsStore(): QualityStatisticsStore {
  let snapshot = createEmptyQualityStatisticsStoreSnapshot("");
  const listeners = new Set<QualityStatisticsStoreListener>();

  function emit_change(): void {
    listeners.forEach((listener) => {
      listener();
    });
  }

  return {
    getSnapshot(): QualityStatisticsStoreSnapshot {
      return snapshot;
    },
    subscribe(listener: QualityStatisticsStoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(project_path: string): void {
      snapshot = createEmptyQualityStatisticsStoreSnapshot(project_path);
      emit_change();
    },
    updateCache(
      rule_type: QualityStatisticsRuleType,
      updater: (cache: QualityStatisticsCacheSnapshot) => QualityStatisticsCacheSnapshot,
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
