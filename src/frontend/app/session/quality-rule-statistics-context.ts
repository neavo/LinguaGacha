import { useEffect, useSyncExternalStore } from "react";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import {
  shouldRequestQualityRuleStatisticsForeground,
  type QualityRuleStatisticsCacheSnapshot,
  type QualityRuleStatisticsRuleType,
} from "@frontend/app/session/quality-rule-statistics-store";

const EMPTY_STATISTICS_CACHE: QualityRuleStatisticsCacheSnapshot = Object.freeze({
  phase: "empty",
  entry_ids: null,
  hits_by_entry_id: {},
  subset_parents_by_entry_id: {},
  last_error: null,
});
const NOOP_SUBSCRIBE = () => () => {};

/**
 * 页面直接订阅当前工程 Store 的质量规则统计，缓存缺失且工程就绪时触发后端 query。
 */
export function useQualityRuleStatistics(
  rule_type: QualityRuleStatisticsRuleType,
): QualityRuleStatisticsCacheSnapshot {
  const { active_project, project_snapshot, project_session_status } = useDesktopState();
  const store = active_project?.qualityStatistics;
  const ready = project_snapshot.loaded && project_session_status === "ready";
  const cache_snapshot = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    () => store?.getSnapshot().caches[rule_type] ?? EMPTY_STATISTICS_CACHE,
    () => store?.getSnapshot().caches[rule_type] ?? EMPTY_STATISTICS_CACHE,
  );
  const should_request_foreground =
    store !== undefined && ready && shouldRequestQualityRuleStatisticsForeground(cache_snapshot);

  useEffect(() => {
    if (should_request_foreground) store.refreshRule(rule_type);
  }, [store, rule_type, should_request_foreground]);

  return cache_snapshot;
}

export { QUALITY_RULE_STATISTICS_RULE_TYPES } from "@frontend/app/session/quality-rule-statistics-store";
