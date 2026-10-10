import { type JSX, useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  useDesktopState,
  useProjectChangeSignalSource,
} from "@frontend/app/state/use-desktop-state";
import {
  createQualityRuleStatisticsStore,
  resolveQualityRuleStatisticsInvalidationScope,
  type QualityRuleStatisticsRuleType,
} from "./quality-rule-statistics-store";
import {
  type QualityRuleStatisticsContextValue,
  QualityRuleStatisticsContext,
} from "./quality-rule-statistics-context";

/** Provider 接入工程生命周期与通知，Store 拥有请求和结果。 */
export function QualityRuleStatisticsProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_session_status } = useDesktopState();
  const change_source = useProjectChangeSignalSource();
  const [store] = useState(createQualityRuleStatisticsStore); // 请求与结果随 Provider 作用域一起释放。

  const ready = project_snapshot.loaded && project_session_status === "ready";
  const project_path = project_snapshot.path;
  useLayoutEffect(() => {
    if (!ready) {
      store.reset("");
      return;
    }
    store.reset(project_path);
    // 当前通知已包含在工程查询事实中，基线和订阅在页面发起补算前一起建立。
    let consumed_seq = change_source.getSnapshot().seq;
    const unsubscribe = change_source.subscribe(() => {
      const signal = change_source.getSnapshot();
      if (signal.seq <= consumed_seq) return;
      consumed_seq = signal.seq;
      store.applyInvalidation(resolveQualityRuleStatisticsInvalidationScope(signal.results));
    });
    return () => {
      unsubscribe();
      store.reset("");
    };
  }, [store, change_source, ready, project_path]);

  // ready 变化会让页面补算 effect 重新执行，唤醒等待工程热机的空缓存。
  const refreshRule = useCallback(
    (rule_type: QualityRuleStatisticsRuleType): void => {
      if (ready) store.refreshRule(rule_type);
    },
    [store, ready],
  );
  const context_value = useMemo<QualityRuleStatisticsContextValue>(
    () => ({ refreshRule, store }),
    [refreshRule, store],
  );
  return (
    <QualityRuleStatisticsContext.Provider value={context_value}>
      {props.children}
    </QualityRuleStatisticsContext.Provider>
  );
}
