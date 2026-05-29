import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import {
  createEmptyQualityRuleStatisticsCacheSnapshot,
  createQualityRuleStatisticsStore,
  expireQualityRuleStatisticsCache,
  QUALITY_RULE_STATISTICS_RULE_TYPES,
  shouldRequestQualityRuleStatisticsForeground,
  type QualityRuleStatisticsCacheSnapshot,
  type QualityRuleStatisticsRuleType,
  type QualityRuleStatisticsStore,
} from "@frontend/app/session/quality-rule-statistics-store";

type QualityStatisticsQueryResponse = {
  projectPath: string;
  statistics: QualityRuleStatisticsCacheSnapshot | null;
};

type QualityRuleStatisticsContextValue = {
  refreshRule: (rule_type: QualityRuleStatisticsRuleType) => void; // refreshRule 从 Backend query 读取 ProjectDataCache 统计结果
  store: QualityRuleStatisticsStore; // store 只保存后端 query 结果，不再执行 renderer 统计
};

const QualityRuleStatisticsContext = createContext<QualityRuleStatisticsContextValue | null>(null);

/**
 * 质量规则统计 Provider 只负责把页面活跃规则映射到后端 query。
 */
export function QualityRuleStatisticsProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_session_status, project_change_signal } = useDesktopState();
  const store_ref = useRef<QualityRuleStatisticsStore | null>(null);
  if (store_ref.current === null) {
    store_ref.current = createQualityRuleStatisticsStore();
  }
  const request_tokens_ref = useRef<Map<QualityRuleStatisticsRuleType, number>>(new Map());

  const refreshRule = useCallback(
    (rule_type: QualityRuleStatisticsRuleType): void => {
      const store = store_ref.current;
      if (
        store === null ||
        !project_snapshot.loaded ||
        project_snapshot.path === "" ||
        project_session_status !== "ready"
      ) {
        return;
      }
      const request_token = (request_tokens_ref.current.get(rule_type) ?? 0) + 1;
      request_tokens_ref.current.set(rule_type, request_token);
      store.updateCache(rule_type, (cache) => ({
        ...cache,
        phase: cache.phase === "current" ? "current" : "running",
        request_token,
      }));
      void api_fetch<QualityStatisticsQueryResponse>("/api/quality/statistics/view", {
        rule_key: rule_type,
      })
        .then((response) => {
          if (
            request_tokens_ref.current.get(rule_type) !== request_token ||
            response.projectPath !== project_snapshot.path
          ) {
            return;
          }
          store.updateCache(rule_type, () =>
            normalize_quality_statistics_cache(response.statistics, request_token),
          );
        })
        .catch((error: unknown) => {
          if (request_tokens_ref.current.get(rule_type) !== request_token) {
            return;
          }
          store.updateCache(rule_type, (cache) => ({
            ...cache,
            phase: "failed",
            last_error: error instanceof Error ? error : new Error(String(error)),
            request_token,
            updated_at: Date.now(),
          }));
        });
    },
    [project_session_status, project_snapshot.loaded, project_snapshot.path],
  );

  useLayoutEffect(() => {
    const store = store_ref.current;
    if (store === null) {
      return;
    }
    if (!project_snapshot.loaded || project_snapshot.path === "") {
      store.reset("");
      return;
    }
    store.reset(project_snapshot.path);
  }, [project_snapshot.loaded, project_snapshot.path]);

  useEffect(() => {
    const store = store_ref.current;
    if (
      store === null ||
      !project_snapshot.loaded ||
      project_snapshot.path === "" ||
      project_session_status !== "ready" ||
      project_change_signal.seq === 0
    ) {
      return;
    }
    const should_expire_statistics = project_change_signal.updated_sections.some((section) => {
      return section === "items" || section === "quality";
    });
    if (!should_expire_statistics) {
      return;
    }
    for (const rule_type of QUALITY_RULE_STATISTICS_RULE_TYPES) {
      request_tokens_ref.current.set(
        rule_type,
        (request_tokens_ref.current.get(rule_type) ?? 0) + 1,
      );
      store.updateCache(rule_type, expireQualityRuleStatisticsCache);
    }
  }, [
    project_change_signal.seq,
    project_change_signal.updated_sections,
    project_session_status,
    project_snapshot.loaded,
    project_snapshot.path,
  ]);

  const context_value = useMemo<QualityRuleStatisticsContextValue>(() => {
    return {
      refreshRule,
      store: store_ref.current!,
    };
  }, [refreshRule]);

  return (
    <QualityRuleStatisticsContext.Provider value={context_value}>
      {props.children}
    </QualityRuleStatisticsContext.Provider>
  );
}

function normalize_quality_statistics_cache(
  value: QualityRuleStatisticsCacheSnapshot | null,
  request_token: number,
): QualityRuleStatisticsCacheSnapshot {
  const previous_value = value ?? undefined;
  return {
    ...createEmptyQualityRuleStatisticsCacheSnapshot(),
    ...previous_value,
    phase: "current",
    last_error: null,
    request_token,
    updated_at: Date.now(),
  };
}

// useQualityRuleStatisticsContext 统一抛出 Provider 缺失错误，调用方不用重复空值分支。
function useQualityRuleStatisticsContext(): QualityRuleStatisticsContextValue {
  const context_value = useContext(QualityRuleStatisticsContext);
  if (context_value === null) {
    throw new Error("useQualityRuleStatistics must be used inside QualityRuleStatisticsProvider.");
  }

  return context_value;
}

/**
 * 页面消费单个质量规则统计时自动激活规则，并在缓存缺失时触发后端 query。
 */
export function useQualityRuleStatistics(
  rule_type: QualityRuleStatisticsRuleType,
): QualityRuleStatisticsCacheSnapshot {
  const { refreshRule, store } = useQualityRuleStatisticsContext();
  const cache_snapshot = useSyncExternalStore(
    store.subscribe,
    () => {
      return store.getSnapshot().caches[rule_type];
    },
    () => {
      return store.getSnapshot().caches[rule_type];
    },
  );
  const should_request_foreground = shouldRequestQualityRuleStatisticsForeground(cache_snapshot);

  useEffect(() => {
    if (should_request_foreground) {
      refreshRule(rule_type);
    }
  }, [refreshRule, rule_type, should_request_foreground]);

  return cache_snapshot;
}

export { QUALITY_RULE_STATISTICS_RULE_TYPES };
