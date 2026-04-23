import {
  executeQualityStatisticsAutoPlan,
  planQualityStatisticsAutoRun,
} from "@/app/project-runtime/quality-statistics-auto";
import {
  prepareQualityStatisticsRuleContext,
  type QualityStatisticsPreparedRuleContext,
} from "@/app/project-runtime/quality-statistics-descriptors";
import type { ProjectStoreState } from "@/app/project-runtime/project-store";
import {
  buildQualityStatisticsCacheFromResults,
  buildQualityStatisticsResultMap,
  type QualityStatisticsRuleType,
  type QualityStatisticsStore,
} from "@/app/project-runtime/quality-statistics-store";
import {
  getSharedQualityStatisticsWorkerPool,
  type QualityStatisticsTaskExecutor,
} from "@/app/project-runtime/quality-statistics-worker-pool";

type RefreshPriority = "warmup" | "background" | "foreground";

type ScheduledRefresh = {
  priority: RefreshPriority;
  force_full: boolean;
  timer_id: ReturnType<typeof globalThis.setTimeout>;
};

type InFlightRefresh = {
  request_key: string;
  promise: Promise<void>;
};

type QualityStatisticsScheduler = {
  warmupAll: () => void;
  markItemsDirty: () => void;
  markQualityDirty: (rule_type: QualityStatisticsRuleType) => void;
  requestForeground: (rule_type: QualityStatisticsRuleType) => void;
  resetProject: (project_path: string) => void;
  dispose: () => void;
};

const REFRESH_DELAY_BY_PRIORITY: Record<RefreshPriority, number> = {
  warmup: 80,
  background: 200,
  foreground: 0,
};

const PRIORITY_ORDER: Record<RefreshPriority, number> = {
  warmup: 1,
  background: 2,
  foreground: 3,
};

function build_request_key(args: {
  project_path: string;
  prepared_context: QualityStatisticsPreparedRuleContext;
  force_full: boolean;
}): string {
  return JSON.stringify({
    project_path: args.project_path,
    snapshot_signature:
      args.prepared_context.current_statistics_context.snapshot.snapshot_signature,
    force_full: args.force_full,
  });
}

function pick_higher_priority(left: RefreshPriority, right: RefreshPriority): RefreshPriority {
  return PRIORITY_ORDER[left] >= PRIORITY_ORDER[right] ? left : right;
}

function create_executor_for_rule_type(
  rule_type: QualityStatisticsRuleType,
): QualityStatisticsTaskExecutor {
  const pool = getSharedQualityStatisticsWorkerPool();
  return {
    async compute(input) {
      return await pool.submit(input, {
        stale_key: `quality-statistics:${rule_type}`,
      });
    },
  };
}

export function createQualityStatisticsScheduler(args: {
  store: QualityStatisticsStore;
  get_project_state: () => ProjectStoreState;
  get_executor?: (rule_type: QualityStatisticsRuleType) => QualityStatisticsTaskExecutor;
}): QualityStatisticsScheduler {
  const get_executor = args.get_executor ?? create_executor_for_rule_type;
  const scheduled_refreshes = new Map<QualityStatisticsRuleType, ScheduledRefresh>();
  const in_flight_refreshes = new Map<QualityStatisticsRuleType, InFlightRefresh>();
  let active_project_path = "";
  let active_session_token = 0;

  function is_active_request(
    rule_type: QualityStatisticsRuleType,
    request_token: number,
    session_token: number,
  ): boolean {
    if (session_token !== active_session_token) {
      return false;
    }

    if (args.store.getSnapshot().project_path !== active_project_path) {
      return false;
    }

    return args.store.getSnapshot().caches[rule_type].request_token === request_token;
  }

  function cancel_scheduled_refresh(rule_type: QualityStatisticsRuleType): void {
    const scheduled_refresh = scheduled_refreshes.get(rule_type);
    if (scheduled_refresh === undefined) {
      return;
    }

    globalThis.clearTimeout(scheduled_refresh.timer_id);
    scheduled_refreshes.delete(rule_type);
  }

  function cancel_all_scheduled_refreshes(): void {
    scheduled_refreshes.forEach((scheduled_refresh) => {
      globalThis.clearTimeout(scheduled_refresh.timer_id);
    });
    scheduled_refreshes.clear();
  }

  function mark_cache_dirty(rule_type: QualityStatisticsRuleType): void {
    args.store.updateCache(rule_type, (cache) => {
      return {
        ...cache,
        ready: false,
        stale:
          cache.running || cache.current_snapshot !== null || cache.completed_snapshot !== null,
        updated_at: Date.now(),
      };
    });
  }

  async function execute_refresh(
    rule_type: QualityStatisticsRuleType,
    options: {
      force_full: boolean;
    },
  ): Promise<void> {
    const project_state = args.get_project_state();
    if (!project_state.project.loaded || project_state.project.path === "") {
      return;
    }

    const prepared_context = prepareQualityStatisticsRuleContext(project_state, rule_type);
    const request_key = build_request_key({
      project_path: project_state.project.path,
      prepared_context,
      force_full: options.force_full,
    });
    const current_in_flight_refresh = in_flight_refreshes.get(rule_type);
    if (current_in_flight_refresh?.request_key === request_key) {
      return await current_in_flight_refresh.promise;
    }

    const previous_cache = args.store.getSnapshot().caches[rule_type];
    const current_snapshot = prepared_context.current_statistics_context.snapshot;
    const auto_plan = planQualityStatisticsAutoRun({
      current_snapshot,
      completed_snapshot: previous_cache.completed_snapshot,
      force_full: options.force_full,
    });
    const request_token = previous_cache.request_token + 1;
    const session_token = active_session_token;

    args.store.updateCache(rule_type, (cache) => {
      return {
        ...cache,
        running: auto_plan.kind !== "noop",
        ready: false,
        stale: auto_plan.kind !== "noop",
        failed: false,
        current_snapshot,
        last_error: null,
        request_token,
        updated_at: Date.now(),
      };
    });

    let refresh_promise: Promise<void> = Promise.resolve();
    refresh_promise = (async (): Promise<void> => {
      try {
        const execution_result = await executeQualityStatisticsAutoPlan({
          executor: get_executor(rule_type),
          current_snapshot,
          completed_snapshot: previous_cache.completed_snapshot,
          previous_results: buildQualityStatisticsResultMap(previous_cache),
          plan: auto_plan,
          rules: prepared_context.current_statistics_context.rules,
          relation_candidates: prepared_context.current_statistics_context.relation_candidates,
          src_texts: prepared_context.project_item_texts.srcTexts,
          dst_texts: prepared_context.project_item_texts.dstTexts,
        });

        if (execution_result.kind !== "success") {
          return;
        }

        if (!is_active_request(rule_type, request_token, session_token)) {
          return;
        }

        args.store.updateCache(rule_type, (cache) => {
          return buildQualityStatisticsCacheFromResults({
            previous_cache: cache,
            current_snapshot,
            results: execution_result.results,
            request_token,
          });
        });
      } catch (error) {
        if (!is_active_request(rule_type, request_token, session_token)) {
          return;
        }

        const runtime_error =
          error instanceof Error ? error : new Error("quality statistics worker 执行失败。");
        args.store.updateCache(rule_type, (cache) => {
          return {
            ...cache,
            running: false,
            ready: false,
            stale: true,
            failed: true,
            current_snapshot,
            last_error: runtime_error,
            request_token,
            updated_at: Date.now(),
          };
        });
      } finally {
        if (in_flight_refreshes.get(rule_type)?.promise === refresh_promise) {
          in_flight_refreshes.delete(rule_type);
        }
      }
    })();

    in_flight_refreshes.set(rule_type, {
      request_key,
      promise: refresh_promise,
    });

    await refresh_promise;
  }

  function schedule_refresh(
    rule_type: QualityStatisticsRuleType,
    options: {
      priority: RefreshPriority;
      force_full?: boolean;
    },
  ): void {
    const project_state = args.get_project_state();
    if (!project_state.project.loaded || project_state.project.path === "") {
      return;
    }

    mark_cache_dirty(rule_type);

    const existing_schedule = scheduled_refreshes.get(rule_type);
    const next_priority =
      existing_schedule === undefined
        ? options.priority
        : pick_higher_priority(existing_schedule.priority, options.priority);
    const next_force_full = Boolean(existing_schedule?.force_full || options.force_full);

    if (
      existing_schedule !== undefined &&
      existing_schedule.priority === next_priority &&
      existing_schedule.force_full === next_force_full
    ) {
      return;
    }

    cancel_scheduled_refresh(rule_type);

    const timer_id = globalThis.setTimeout(() => {
      scheduled_refreshes.delete(rule_type);
      void execute_refresh(rule_type, {
        force_full: next_force_full,
      });
    }, REFRESH_DELAY_BY_PRIORITY[next_priority]);

    scheduled_refreshes.set(rule_type, {
      priority: next_priority,
      force_full: next_force_full,
      timer_id,
    });
  }

  function warmupAll(): void {
    schedule_refresh("glossary", {
      priority: "warmup",
    });
    schedule_refresh("pre_replacement", {
      priority: "warmup",
    });
    schedule_refresh("post_replacement", {
      priority: "warmup",
    });
    schedule_refresh("text_preserve", {
      priority: "warmup",
    });
  }

  function markItemsDirty(): void {
    schedule_refresh("glossary", {
      priority: "background",
    });
    schedule_refresh("pre_replacement", {
      priority: "background",
    });
    schedule_refresh("post_replacement", {
      priority: "background",
    });
    schedule_refresh("text_preserve", {
      priority: "background",
    });
  }

  function markQualityDirty(rule_type: QualityStatisticsRuleType): void {
    schedule_refresh(rule_type, {
      priority: "background",
    });
  }

  function requestForeground(rule_type: QualityStatisticsRuleType): void {
    schedule_refresh(rule_type, {
      priority: "foreground",
    });
  }

  function resetProject(project_path: string): void {
    cancel_all_scheduled_refreshes();
    active_session_token += 1;
    active_project_path = project_path;
    args.store.reset(project_path);
  }

  function dispose(): void {
    cancel_all_scheduled_refreshes();
    active_session_token += 1;
    in_flight_refreshes.clear();
  }

  return {
    warmupAll,
    markItemsDirty,
    markQualityDirty,
    requestForeground,
    resetProject,
    dispose,
  };
}

export { REFRESH_DELAY_BY_PRIORITY };
export type { QualityStatisticsScheduler };
