import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import {
  shouldRequestQualityRuleStatisticsForeground,
  type QualityRuleStatisticsCacheSnapshot,
  type QualityRuleStatisticsRuleType,
  type QualityRuleStatisticsStore,
} from "@frontend/app/session/quality-rule-statistics-store";

export type QualityRuleStatisticsContextValue = {
  refreshRule: (rule_type: QualityRuleStatisticsRuleType) => void; // 从 Backend query 读取 ProjectDataCache 统计结果
  store: QualityRuleStatisticsStore; // 只保存后端 query 结果，不再执行 renderer 统计
};

export const QualityRuleStatisticsContext = createContext<QualityRuleStatisticsContextValue | null>(
  null,
);

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
