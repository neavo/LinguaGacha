import {
  executeQualityStatisticsAutoPlan,
  planQualityStatisticsAutoRun,
  remapQualityStatisticsResults,
} from "@/project/quality/quality-statistics-auto";
import type { QualityStatisticsTaskExecutor } from "@/project/quality/quality-statistics";
import {
  prepareQualityRuleStatisticsRuleContext,
  type QualityRuleStatisticsPreparedRuleContext,
} from "@/project/quality/quality-rule-statistics-descriptors";
import type { ProjectStoreState } from "@/project/store/project-store";
import {
  buildQualityRuleStatisticsCacheFromResults,
  buildQualityRuleStatisticsResultMap,
  type QualityRuleStatisticsRuleType,
  type QualityRuleStatisticsStore,
} from "@/project/quality/quality-rule-statistics-store";
import { getSharedProjectUiWorkerClient } from "@/project/worker/project-ui-worker-client";
import { ProjectUiWorkerClientError } from "@/project/worker/project-ui-worker-errors";
import { JsonTool } from "../../../shared/utils/json-tool";

type RefreshPriority = "background" | "foreground"; // RefreshPriority 区分页面可见刷新和后台追赶刷新

type ScheduledRefresh = {
  priority: RefreshPriority; // priority 决定本次延迟刷新等待时间
  force_full: boolean; // force_full 强制跳过增量计划，重新计算完整统计
  timer_id: ReturnType<typeof globalThis.setTimeout>; // timer_id 用于同 rule_type 合并和取消刷新
};

type InFlightRefresh = {
  request_key: string; // request_key 去重相同项目、快照和刷新模式下的并发请求
  request_token: number; // request_token 与缓存 token 对齐，用于判断 in-flight 是否已被后续变更废弃
  promise: Promise<void>; // promise 复用正在执行的统计任务，避免重复派发 worker
};

type QualityRuleStatisticsScheduler = {
  markQualityDirty: (rule_type: QualityRuleStatisticsRuleType) => void; // markQualityDirty 只刷新已挂载页面正在消费的规则
  requestForeground: (rule_type: QualityRuleStatisticsRuleType) => void; // requestForeground 服务用户打开面板的即时刷新
  resetProject: (project_path: string) => void; // resetProject 切换项目并废弃旧会话结果
  dispose: () => void; // dispose 清理定时器和 in-flight 记录
};

// 不同优先级用固定延迟合并高频修改，前台请求保持立即响应。
const REFRESH_DELAY_BY_PRIORITY: Record<RefreshPriority, number> = {
  background: 200,
  foreground: 0,
};

// 数值越大优先级越高；同一规则重复调度时只提升不降级。
const PRIORITY_ORDER: Record<RefreshPriority, number> = {
  background: 1,
  foreground: 2,
};

/**
 * 生成 in-flight 去重键；项目、统计快照和全量/增量策略任一变化都必须重新计算。
 */
function build_request_key(args: {
  project_path: string;
  prepared_context: QualityRuleStatisticsPreparedRuleContext;
  force_full: boolean;
}): string {
  return JsonTool.stringifyStrict({
    project_path: args.project_path,
    snapshot_signature:
      args.prepared_context.current_statistics_context.snapshot.snapshot_signature,
    force_full: args.force_full,
  });
}

/**
 * 合并同 rule_type 的重复刷新请求，前台请求可以覆盖后台等待。
 */
function pick_higher_priority(left: RefreshPriority, right: RefreshPriority): RefreshPriority {
  return PRIORITY_ORDER[left] >= PRIORITY_ORDER[right] ? left : right;
}

/**
 * 为指定规则创建 worker 执行器，调度器只依赖任务接口，不直接知道 worker 协议细节。
 */
function create_executor_for_rule_type(
  rule_type: QualityRuleStatisticsRuleType,
): QualityStatisticsTaskExecutor {
  const client = getSharedProjectUiWorkerClient();
  return {
    /**
     * 按当前缓存状态计算下一步统计任务，避免重复调度
     */
    async compute(input) {
      return await client.compute_quality_statistics(input, {
        staleKey: `quality-statistics:${rule_type}`,
        priority: "background",
      });
    },
  };
}

/**
 * 创建质量统计调度器；它拥有刷新节流、会话废弃和缓存落库前的最后裁决。
 */
export function createQualityRuleStatisticsScheduler(args: {
  store: QualityRuleStatisticsStore;
  get_project_state: () => ProjectStoreState;
  get_executor?: (rule_type: QualityRuleStatisticsRuleType) => QualityStatisticsTaskExecutor;
}): QualityRuleStatisticsScheduler {
  const get_executor = args.get_executor ?? create_executor_for_rule_type;
  const scheduled_refreshes = new Map<QualityRuleStatisticsRuleType, ScheduledRefresh>();
  const in_flight_refreshes = new Map<QualityRuleStatisticsRuleType, InFlightRefresh>();
  let active_project_path = ""; // active_project_path 防止旧项目的迟到结果写入新项目缓存
  let active_session_token = 0; // active_session_token 每次 reset/dispose 递增，用于废弃旧异步链路

  /**
   * 判断异步返回仍属于当前项目和当前缓存请求，迟到结果一律丢弃。
   */
  function is_active_request(
    rule_type: QualityRuleStatisticsRuleType,
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

  /**
   * 取消单个规则的等待刷新，用于提升优先级或项目切换。
   */
  function cancel_scheduled_refresh(rule_type: QualityRuleStatisticsRuleType): void {
    const scheduled_refresh = scheduled_refreshes.get(rule_type);
    if (scheduled_refresh === undefined) {
      return;
    }

    globalThis.clearTimeout(scheduled_refresh.timer_id);
    scheduled_refreshes.delete(rule_type);
  }

  /**
   * 清空所有等待刷新；reset 和 dispose 都必须先停止未来定时回调。
   */
  function cancel_all_scheduled_refreshes(): void {
    scheduled_refreshes.forEach((scheduled_refresh) => {
      globalThis.clearTimeout(scheduled_refresh.timer_id);
    });
    scheduled_refreshes.clear();
  }

  /**
   * 把缓存置为已调度状态，并立即废弃更早的 in-flight 结果。
   */
  function mark_cache_scheduled(rule_type: QualityRuleStatisticsRuleType): void {
    args.store.updateCache(rule_type, (cache) => {
      return {
        ...cache,
        phase: "scheduled",
        last_error: null,
        request_token: cache.request_token + 1,
        updated_at: Date.now(),
      };
    });
  }

  /**
   * 执行一次统计刷新；同请求去重、自动增量规划和迟到结果废弃都在这里闭环。
   */
  async function execute_refresh(
    rule_type: QualityRuleStatisticsRuleType,
    options: {
      force_full: boolean;
    },
  ): Promise<void> {
    const project_state = args.get_project_state();
    if (!project_state.project.loaded || project_state.project.path === "") {
      return;
    }

    const prepared_context = prepareQualityRuleStatisticsRuleContext(project_state, rule_type);
    const request_key = build_request_key({
      project_path: project_state.project.path,
      prepared_context,
      force_full: options.force_full,
    });
    const current_in_flight_refresh = in_flight_refreshes.get(rule_type);
    const current_cache = args.store.getSnapshot().caches[rule_type];
    if (
      current_in_flight_refresh?.request_key === request_key &&
      current_cache.request_token === current_in_flight_refresh.request_token
    ) {
      return await current_in_flight_refresh.promise;
    }

    const previous_cache = current_cache;
    const current_snapshot = prepared_context.current_statistics_context.snapshot;
    const auto_plan = planQualityStatisticsAutoRun({
      current_snapshot,
      completed_snapshot: previous_cache.completed_snapshot,
      force_full: options.force_full,
    });
    const request_token = previous_cache.request_token + 1;
    const session_token = active_session_token;

    // noop/remap 不占用 worker，也不能暴露 refresh 中间态，否则页面会把删除规则误判为前台待刷新。
    if (auto_plan.kind === "noop" || auto_plan.target_rule_keys.length === 0) {
      const remapped_results = remapQualityStatisticsResults({
        completed_snapshot: previous_cache.completed_snapshot,
        current_snapshot,
        previous_results: buildQualityRuleStatisticsResultMap(previous_cache),
      });
      args.store.updateCache(rule_type, (cache) => {
        return buildQualityRuleStatisticsCacheFromResults({
          previous_cache: cache,
          current_snapshot,
          results: remapped_results,
          request_token,
        });
      });
      return;
    }

    args.store.updateCache(rule_type, (cache) => {
      return {
        ...cache,
        phase: "running",
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
          previous_results: buildQualityRuleStatisticsResultMap(previous_cache),
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
          return buildQualityRuleStatisticsCacheFromResults({
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
          error instanceof Error ? error : new ProjectUiWorkerClientError("execution_failed");
        args.store.updateCache(rule_type, (cache) => {
          return {
            ...cache,
            phase: "failed",
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
      request_token,
      promise: refresh_promise,
    });

    await refresh_promise;
  }

  /**
   * 安排一次刷新并合并同 rule_type 的等待任务，避免编辑时反复派发 worker。
   */
  function schedule_refresh(
    rule_type: QualityRuleStatisticsRuleType,
    options: {
      priority: RefreshPriority;
      force_full?: boolean;
    },
  ): void {
    const project_state = args.get_project_state();
    if (!project_state.project.loaded || project_state.project.path === "") {
      return;
    }

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
    mark_cache_scheduled(rule_type);

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

  /**
   * 已挂载页面正在消费的质量规则变化后安排后台刷新，UI 可继续读旧缓存。
   */
  function markQualityDirty(rule_type: QualityRuleStatisticsRuleType): void {
    schedule_refresh(rule_type, {
      priority: "background",
    });
  }

  /**
   * 用户进入对应面板时立即刷新当前规则，提高可见路径响应优先级。
   */
  function requestForeground(rule_type: QualityRuleStatisticsRuleType): void {
    schedule_refresh(rule_type, {
      priority: "foreground",
    });
  }

  /**
   * 切换项目时重建统计会话，所有旧项目结果即使返回也不能写入新缓存。
   */
  function resetProject(project_path: string): void {
    cancel_all_scheduled_refreshes();
    active_session_token += 1;
    active_project_path = project_path;
    args.store.reset(project_path);
  }

  /**
   * 释放调度器本地资源；in-flight worker 结果通过 session token 自然失效。
   */
  function dispose(): void {
    cancel_all_scheduled_refreshes();
    active_session_token += 1;
    in_flight_refreshes.clear();
  }

  return {
    markQualityDirty,
    requestForeground,
    resetProject,
    dispose,
  };
}

export { REFRESH_DELAY_BY_PRIORITY };
export type { QualityRuleStatisticsScheduler };
