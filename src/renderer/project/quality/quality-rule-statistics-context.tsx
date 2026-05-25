import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createQualityRuleStatisticsScheduler } from "@/project/quality/quality-rule-statistics-scheduler";
import {
  createQualityRuleStatisticsStore,
  expireQualityRuleStatisticsCache,
  QUALITY_RULE_STATISTICS_RULE_TYPES,
  shouldRequestQualityRuleStatisticsForeground,
  type QualityRuleStatisticsCacheSnapshot,
  type QualityRuleStatisticsRuleType,
  type QualityRuleStatisticsStore,
} from "@/project/quality/quality-rule-statistics-store";
import { prepareQualityRuleStatisticsRuleContext } from "@/project/quality/quality-rule-statistics-descriptors";
import type { ProjectStoreState } from "@/project/store/project-store";
import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";

type QualityRuleStatisticsContextValue = {
  activateRule: (rule_type: QualityRuleStatisticsRuleType) => () => void; // activateRule 记录页面正在消费的规则
  scheduler: ReturnType<typeof createQualityRuleStatisticsScheduler>; // scheduler 拥有质量规则刷新节流和 worker 执行
  store: QualityRuleStatisticsStore; // store 保存 renderer 内存缓存，不写 ProjectStore
};

const QualityRuleStatisticsContext = createContext<QualityRuleStatisticsContextValue | null>(null);

/**
 * 只提取会影响统计结果的依赖签名，避免 dst/info 等展示字段误触发统计刷新。
 */
function extract_quality_dependency_signatures(
  state: ProjectStoreState,
): Record<QualityRuleStatisticsRuleType, string> {
  return Object.fromEntries(
    QUALITY_RULE_STATISTICS_RULE_TYPES.map((rule_type) => {
      const prepared_context = prepareQualityRuleStatisticsRuleContext(state, rule_type);
      return [rule_type, prepared_context.current_statistics_context.snapshot.snapshot_signature];
    }),
  ) as Record<QualityRuleStatisticsRuleType, string>;
}

/**
 * 质量规则统计 Provider 只提供共享调度和缓存，具体规则是否活跃由页面 hook 声明。
 */
export function QualityRuleStatisticsProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot, project_store, project_session_status } = useDesktopRuntime();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );
  const store_ref = useRef<QualityRuleStatisticsStore | null>(null);
  if (store_ref.current === null) {
    store_ref.current = createQualityRuleStatisticsStore();
  }

  // project_store_state_ref 给调度器读取最新 ProjectStore，避免重建 scheduler 丢失 in-flight 去重。
  const project_store_state_ref = useRef(project_store_state);
  project_store_state_ref.current = project_store_state;
  // scheduler_ref 是质量统计的会话级调度器，Provider 生命周期内保持稳定。
  const scheduler_ref = useRef<ReturnType<typeof createQualityRuleStatisticsScheduler> | null>(
    null,
  );
  if (scheduler_ref.current === null) {
    scheduler_ref.current = createQualityRuleStatisticsScheduler({
      store: store_ref.current,
      get_project_state: () => {
        return project_store_state_ref.current;
      },
    });
  }

  const previous_project_path_ref = useRef("");
  // previous_quality_signatures_ref 保存上一轮可见依赖签名，用于判断哪些规则缓存需要失效。
  const previous_quality_signatures_ref = useRef<Record<
    QualityRuleStatisticsRuleType,
    string
  > | null>(null);
  const active_rule_counts_ref = useRef<Map<QualityRuleStatisticsRuleType, number>>(new Map()); // active_rule_counts_ref 支持同规则被多个页面片段同时消费

  // Provider 拥有质量统计缓存会话，项目切换时必须先 reset，再接受新项目的派生结果。
  useEffect(() => {
    const scheduler = scheduler_ref.current;
    return () => {
      scheduler?.dispose();
    };
  }, []);

  useEffect(() => {
    const scheduler = scheduler_ref.current;
    if (scheduler === null) {
      return;
    }

    if (!project_snapshot.loaded || project_snapshot.path === "") {
      previous_project_path_ref.current = "";
      previous_quality_signatures_ref.current = null;
      scheduler.resetProject("");
      return;
    }

    if (previous_project_path_ref.current !== project_snapshot.path) {
      previous_project_path_ref.current = project_snapshot.path;
      previous_quality_signatures_ref.current =
        extract_quality_dependency_signatures(project_store_state);
      scheduler.resetProject(project_snapshot.path);
    }
  }, [project_snapshot.loaded, project_snapshot.path, project_store_state]);

  useEffect(() => {
    const scheduler = scheduler_ref.current;
    const store = store_ref.current;
    if (
      scheduler === null ||
      store === null ||
      !project_snapshot.loaded ||
      project_snapshot.path === ""
    ) {
      return;
    }

    const current_quality_signatures = extract_quality_dependency_signatures(project_store_state);

    if (project_session_status === "ready") {
      const previous_quality_signatures = previous_quality_signatures_ref.current;
      if (previous_quality_signatures !== null) {
        QUALITY_RULE_STATISTICS_RULE_TYPES.forEach((rule_type) => {
          if (previous_quality_signatures[rule_type] !== current_quality_signatures[rule_type]) {
            if ((active_rule_counts_ref.current.get(rule_type) ?? 0) > 0) {
              scheduler.markQualityDirty(rule_type);
            } else {
              store.updateCache(rule_type, expireQualityRuleStatisticsCache);
            }
          }
        });
      }
    }

    previous_quality_signatures_ref.current = current_quality_signatures;
  }, [project_snapshot.loaded, project_snapshot.path, project_store_state, project_session_status]);

  // activateRule 用引用计数表达页面挂载关系，避免未挂载质量页继续后台刷新。
  const activateRule = useMemo<QualityRuleStatisticsContextValue["activateRule"]>(() => {
    return (rule_type) => {
      const current_count = active_rule_counts_ref.current.get(rule_type) ?? 0;
      active_rule_counts_ref.current.set(rule_type, current_count + 1);

      return () => {
        const next_count = (active_rule_counts_ref.current.get(rule_type) ?? 1) - 1;
        if (next_count <= 0) {
          active_rule_counts_ref.current.delete(rule_type);
        } else {
          active_rule_counts_ref.current.set(rule_type, next_count);
        }
      };
    };
  }, []);

  const context_value = useMemo<QualityRuleStatisticsContextValue>(() => {
    return {
      activateRule,
      scheduler: scheduler_ref.current!,
      store: store_ref.current!,
    };
  }, [activateRule]);

  return (
    <QualityRuleStatisticsContext.Provider value={context_value}>
      {props.children}
    </QualityRuleStatisticsContext.Provider>
  );
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
 * 页面消费单个质量规则统计时自动激活规则，并在缓存缺失时触发前台补算。
 */
export function useQualityRuleStatistics(
  rule_type: QualityRuleStatisticsRuleType,
): QualityRuleStatisticsCacheSnapshot {
  const { activateRule, scheduler, store } = useQualityRuleStatisticsContext();
  const cache_snapshot = useSyncExternalStore(
    store.subscribe,
    () => {
      return store.getSnapshot().caches[rule_type];
    },
    () => {
      return store.getSnapshot().caches[rule_type];
    },
  );
  // 前台补算只允许空缓存发起，避免 scheduled/noop/remap 阶段被页面 effect 反复触发。
  const should_request_foreground = shouldRequestQualityRuleStatisticsForeground(cache_snapshot);

  useEffect(() => {
    return activateRule(rule_type);
  }, [activateRule, rule_type]);

  useEffect(() => {
    if (should_request_foreground) {
      scheduler.requestForeground(rule_type);
    }
  }, [rule_type, scheduler, should_request_foreground]);

  return cache_snapshot;
}
