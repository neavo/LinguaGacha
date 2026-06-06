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
  resolveQualityRuleStatisticsRulesToExpire,
  shouldRequestQualityRuleStatisticsForeground,
  type QualityRuleStatisticsCacheSnapshot,
  type QualityRuleStatisticsRuleType,
  type QualityRuleStatisticsStore,
} from "@frontend/app/session/quality-rule-statistics-store";

type QualityStatisticsQueryResponse = {
  projectPath: string; // 后端确认的项目身份，用于丢弃迟到旧项目结果。
  statistics: QualityRuleStatisticsCacheSnapshot | null; // null 表示后端无可复用统计，前端恢复成当前快照形状。
};

type QualityRuleStatisticsContextValue = {
  refreshRule: (rule_type: QualityRuleStatisticsRuleType) => void; // 从 Backend query 读取 ProjectDataCache 统计结果
  store: QualityRuleStatisticsStore; // 只保存后端 query 结果，不再执行 renderer 统计
};

const QualityRuleStatisticsContext = createContext<QualityRuleStatisticsContextValue | null>(null);

/**
 * 质量规则统计 Provider 只负责把页面活跃规则映射到后端 query。
 */
export function QualityRuleStatisticsProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_session_status, project_change_signal } = useDesktopState();
  // store_ref 保持项目 session 内共享缓存身份，避免 Provider 重渲染重建订阅源。
  const store_ref = useRef<QualityRuleStatisticsStore | null>(null);
  if (store_ref.current === null) {
    store_ref.current = createQualityRuleStatisticsStore();
  }
  // 每个规则独立维护 request token，避免旧请求覆盖新一轮统计结果。
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
      // 前台请求先推进 token，再把缓存标记为运行中，保证失败和迟到结果都能按 token 收口。
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
    const rules_to_expire = resolveQualityRuleStatisticsRulesToExpire(project_change_signal);
    if (rules_to_expire.length === 0) {
      return;
    }
    // 失效同步推进 token，确保已经发出的旧请求完成后也无法写回缓存。
    for (const rule_type of rules_to_expire) {
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

/**
 * 后端返回 null 或旧形状时恢复完整缓存结构，并标记为当前结果。
 */
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

// 统一抛出 Provider 缺失错误，调用方不用重复空值分支。
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

export { QUALITY_RULE_STATISTICS_RULE_TYPES } from "@frontend/app/session/quality-rule-statistics-store";
