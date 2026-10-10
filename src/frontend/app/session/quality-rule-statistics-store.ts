import { QUALITY_RULE_KINDS } from "@domain/quality";
import type { QualityStatisticsTextChangeScope } from "@shared/project-event";
import { api_fetch } from "@frontend/app/desktop/desktop-api";

export type QualityStatisticsQueryResponse = {
  projectPath: string;
  statistics: {
    entry_ids: string[];
    hits_by_entry_id: Record<string, number>;
    subset_parents_by_entry_id: Record<string, string[]>;
  };
};

type QualityStatisticsQuery = (
  rule_type: QualityRuleStatisticsRuleType,
) => Promise<QualityStatisticsQueryResponse>;

// 渲染进程统计调度消费的共享规则词表别名。
export const QUALITY_RULE_STATISTICS_RULE_TYPES = QUALITY_RULE_KINDS;

// 页面、调度器和 store 共享的质量统计规则窄化类型。
export type QualityRuleStatisticsRuleType = (typeof QUALITY_RULE_STATISTICS_RULE_TYPES)[number];

// `phase` 是质量统计缓存唯一的刷新状态源。
export type QualityRuleStatisticsCachePhase = "empty" | "running" | "current" | "failed";

export type QualityRuleStatisticsCacheSnapshot = {
  phase: QualityRuleStatisticsCachePhase; // 页面刷新与前台补算的状态。
  entry_ids: string[] | null; // null 区分尚无结果和已完成的空规则集合。
  hits_by_entry_id: Record<string, number>; // 徽标 hits 的计算结果表。
  subset_parents_by_entry_id: Record<string, string[]>; // 子集关系徽标的计算结果表。
  last_error: Error | null; // 只描述最近一次统计执行失败，不参与项目事实判断。
};

export type QualityRuleStatisticsStoreSnapshot = {
  project_path: string; // 缓存会话身份，切换项目必须整体 reset
  caches: Record<QualityRuleStatisticsRuleType, QualityRuleStatisticsCacheSnapshot>; // 按规则类型隔离统计结果
};

// 渲染进程内存 store 的轻量订阅回调。
type QualityRuleStatisticsStoreListener = () => void;

export type QualityRuleStatisticsStore = {
  getSnapshot: () => QualityRuleStatisticsStoreSnapshot; // 暴露渲染进程计算缓存快照。
  subscribe: (listener: QualityRuleStatisticsStoreListener) => () => void; // 通知页面重读缓存。
  reset: (project_path: string) => void; // 切换项目并清空旧项目统计缓存。
  refreshRule: (rule_type: QualityRuleStatisticsRuleType) => void; // 当前规则请求替换旧请求身份。
  applyInvalidation: (scope: QualityStatisticsTextChangeScope) => void; // 撤销受影响请求并清空结果。
};

/**
 * 创建尚未计算过的缓存；页面只会从这个阶段发起前台补算。
 */
export function createEmptyQualityRuleStatisticsCacheSnapshot(): QualityRuleStatisticsCacheSnapshot {
  return {
    phase: "empty",
    entry_ids: null,
    hits_by_entry_id: {},
    subset_parents_by_entry_id: {},
    last_error: null,
  };
}

/**
 * current 表示最近一次统计成功。
 */
export function isQualityRuleStatisticsCacheReady(
  cache: QualityRuleStatisticsCacheSnapshot,
): boolean {
  return cache.phase === "current";
}

/** 依赖失效会清空结果，刷新失败仍可使用同一工程中已完成的统计。 */
export function canSortQualityRuleStatistics(cache: QualityRuleStatisticsCacheSnapshot): boolean {
  return cache.entry_ids !== null;
}

/**
 * running 只表示首次统计正在计算；刷新已有结果时继续保持 current 展示旧值。
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
  return cache.phase === "empty";
}

/**
 * 合并项目变更携带的统计失效范围，Provider 只消费这个单一判定入口。
 */
export function resolveQualityRuleStatisticsInvalidationScope(
  results: readonly { qualityStatisticsScope: QualityStatisticsTextChangeScope }[],
): QualityStatisticsTextChangeScope {
  if (results.some((result) => result.qualityStatisticsScope === "all")) return "all";
  return results.some((result) => result.qualityStatisticsScope === "post_replacement")
    ? "post_replacement"
    : "none";
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
function expireQualityRuleStatisticsCache(
  cache: QualityRuleStatisticsCacheSnapshot,
): QualityRuleStatisticsCacheSnapshot {
  if (cache.phase === "empty") {
    return cache;
  }

  return createEmptyQualityRuleStatisticsCacheSnapshot();
}

/**
 * 创建渲染进程内存 store；同引用更新不广播，避免无语义刷新触发页面 effect。
 */
export function createQualityRuleStatisticsStore(
  query: QualityStatisticsQuery = (rule_type) =>
    api_fetch<QualityStatisticsQueryResponse>("/api/quality/statistics/view", {
      rule_key: rule_type,
    }),
): QualityRuleStatisticsStore {
  let snapshot = createEmptyQualityRuleStatisticsStoreSnapshot(""); // 唯一展示快照，订阅者按引用判断更新。
  const listeners = new Set<QualityRuleStatisticsStoreListener>();
  // Promise 身份同时保护工程重载和同规则刷新，旧请求不能发布或清理新请求。
  const requests = new Map<
    QualityRuleStatisticsRuleType,
    Promise<QualityStatisticsQueryResponse>
  >();

  /** 同步发布结果，页面从同一快照读取刷新状态。 */
  function emit_change(): void {
    for (const listener of listeners) listener();
  }

  /** 内部更新单个规则，结果未变时保持订阅快照身份。 */
  function updateCache(
    rule_type: QualityRuleStatisticsRuleType,
    updater: (cache: QualityRuleStatisticsCacheSnapshot) => QualityRuleStatisticsCacheSnapshot,
  ): void {
    const previous = snapshot.caches[rule_type];
    const next = updater(previous);
    if (next === previous) return;
    snapshot = { ...snapshot, caches: { ...snapshot.caches, [rule_type]: next } };
    emit_change();
  }

  return {
    getSnapshot: () => snapshot, // 读取期间保持引用稳定。
    /** 订阅者负责在自身作用域结束时取消订阅。 */
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 新工程包括同路径重载，必须撤销全部在途请求。 */
    reset(project_path): void {
      requests.clear();
      snapshot = createEmptyQualityRuleStatisticsStoreSnapshot(project_path);
      emit_change();
    },
    /** 只有仍被记录的 Promise 可以发布或清理请求结果。 */
    refreshRule(rule_type): void {
      const project_path = snapshot.project_path;
      if (project_path === "") return;
      const request = query(rule_type);
      requests.set(rule_type, request);
      updateCache(rule_type, (cache) => ({
        ...cache,
        phase: cache.phase === "current" ? "current" : "running",
        last_error: null,
      }));
      void request
        .then((response) => {
          if (requests.get(rule_type) !== request || response.projectPath !== project_path) return;
          updateCache(rule_type, () => ({
            ...createEmptyQualityRuleStatisticsCacheSnapshot(),
            ...response.statistics,
            phase: "current",
          }));
        })
        .catch((error: unknown) => {
          if (requests.get(rule_type) !== request) return;
          updateCache(rule_type, (cache) => ({
            ...cache,
            phase: "failed",
            last_error: error instanceof Error ? error : new Error(String(error)),
          }));
        })
        .finally(() => {
          if (requests.get(rule_type) === request) requests.delete(rule_type);
        });
    },
    /** 未挂载规则清空即可，活跃页面依据空缓存发起补算。 */
    applyInvalidation(scope): void {
      const rules =
        scope === "all"
          ? QUALITY_RULE_STATISTICS_RULE_TYPES
          : scope === "post_replacement"
            ? (["post_replacement"] as const)
            : [];
      for (const rule_type of rules) {
        requests.delete(rule_type);
        updateCache(rule_type, expireQualityRuleStatisticsCache);
      }
    },
  };
}
