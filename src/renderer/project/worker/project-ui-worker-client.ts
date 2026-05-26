import type {
  ProofreadingClientItem,
  ProofreadingFilterPanelState,
  ProofreadingListView,
} from "@/pages/proofreading-page/types";
import type {
  ProofreadingFilterPanelQuery,
  ProofreadingItemsByRowIdsQuery,
  ProofreadingListViewQuery,
  ProofreadingListWindow,
  ProofreadingListWindowQuery,
  ProofreadingRowIndexQuery,
  ProofreadingRowIdsRangeQuery,
  ProofreadingRuntimeDeltaInput,
  ProofreadingRuntimeEvaluatedSliceResult,
  ProofreadingRuntimeHydrationInput,
  ProofreadingRuntimeSyncState,
} from "@/project/worker/proofreading-ui-worker-service";
import type {
  QualityStatisticsTaskInput,
  QualityStatisticsTaskResult,
} from "@/project/quality/quality-statistics";
import {
  ProjectUiWorkerScheduler,
  type ProjectUiWorkerSubmitOptions,
} from "@/project/worker/project-ui-worker-scheduler";
import { resolve_default_worker_count } from "@shared/worker-capacity";

const PROOFREADING_HYDRATE_WORKER_LIMIT = 3; // 校对 hydrate 的结构化 clone 成本较高，单场景再收一层上限。
const PROOFREADING_HYDRATE_MIN_ITEMS_PER_WORKER = 512; // 小项目走单 worker，避免分片调度成本高于收益。
const PROOFREADING_HYDRATE_STALE_KEY = "proofreading:hydrate"; // hydrate 与释放共享 stale key，释放时先让旧分片退场。

type ProjectUiWorkerClientOptions = {
  hydrationWorkerCount?: number;
  createHydrationScheduler?: () => ProjectUiWorkerScheduler;
};

type ProjectUiWorkerListQueryOptions = {
  staleKey?: string | null;
};

export type ProjectUiWorkerClient = {
  /**
   * 全量同步校对 UI 缓存；只接收 ProjectStore 派生的只读快照。
   */
  hydrate_proofreading_full: (
    input: ProofreadingRuntimeHydrationInput,
  ) => Promise<ProofreadingRuntimeSyncState>;
  /**
   * 增量同步校对 item 变化，worker 内负责维护计数与列表缓存。
   */
  apply_proofreading_item_delta: (
    input: ProofreadingRuntimeDeltaInput,
  ) => Promise<ProofreadingRuntimeSyncState>;
  /**
   * 构建校对主列表视图；同类旧请求可被新查询覆盖。
   */
  build_proofreading_list_view: (
    input: ProofreadingListViewQuery,
    options?: ProjectUiWorkerListQueryOptions,
  ) => Promise<ProofreadingListView>;
  /**
   * 读取当前列表视图窗口；滚动中的旧窗口请求可被新窗口覆盖。
   */
  read_proofreading_list_window: (
    input: ProofreadingListWindowQuery,
  ) => Promise<ProofreadingListWindow>;
  /**
   * 读取当前视图 row id 范围，供批量操作和选择逻辑消费。
   */
  read_proofreading_row_ids_range: (input: ProofreadingRowIdsRangeQuery) => Promise<string[]>;
  /**
   * 在 worker 的当前列表视图缓存内解析 row id 所在索引，供恢复滚动消费。
   */
  resolve_proofreading_row_index: (input: ProofreadingRowIndexQuery) => Promise<number | undefined>;
  /**
   * 按 row id 回读当前 worker 缓存中的校对条目。
   */
  read_proofreading_items_by_row_ids: (
    input: ProofreadingItemsByRowIdsQuery,
  ) => Promise<ProofreadingClientItem[]>;
  /**
   * 构建校对筛选面板统计，优先级低于用户正在等待的列表窗口。
   */
  build_proofreading_filter_panel: (
    input: ProofreadingFilterPanelQuery,
  ) => Promise<ProofreadingFilterPanelState>;
  /**
   * 执行质量统计任务；调用方用 staleKey 表达同类后台任务的新旧关系。
   */
  compute_quality_statistics: (
    input: QualityStatisticsTaskInput,
    options?: ProjectUiWorkerSubmitOptions,
  ) => Promise<QualityStatisticsTaskResult>;
  /**
   * 释放指定项目的 UI 派生缓存，不终止共享 worker 通道。
   */
  dispose_project: (projectId: string) => Promise<void>;
  /**
   * 终止共享 worker client；只给测试和 renderer 生命周期收尾使用。
   */
  dispose: () => void;
};

let shared_project_ui_worker_client: ProjectUiWorkerClient | null = null;

/**
 * 创建 Project UI Worker client；公开方法只表达项目 UI 派生查询，不暴露底层消息协议。
 */
export function createProjectUiWorkerClient(
  scheduler: ProjectUiWorkerScheduler = new ProjectUiWorkerScheduler(),
  options: ProjectUiWorkerClientOptions = {},
): ProjectUiWorkerClient {
  const hydration_schedulers: ProjectUiWorkerScheduler[] = [];

  const ensure_hydration_schedulers = (worker_count: number): ProjectUiWorkerScheduler[] => {
    while (hydration_schedulers.length < Math.max(0, worker_count - 1)) {
      hydration_schedulers.push(
        options.createHydrationScheduler === undefined
          ? new ProjectUiWorkerScheduler()
          : options.createHydrationScheduler(),
      );
    }
    return [scheduler, ...hydration_schedulers].slice(0, worker_count);
  };

  const hydrate_proofreading_full = async (
    input: ProofreadingRuntimeHydrationInput,
  ): Promise<ProofreadingRuntimeSyncState> => {
    const worker_count = resolve_proofreading_hydrate_worker_count({
      item_count: input.upsertItems.length,
      configured_worker_count: options.hydrationWorkerCount,
    });
    if (worker_count <= 1) {
      return await scheduler.submit(
        {
          type: "proofreading.hydrate_full",
          input,
        },
        { priority: "normal", staleKey: PROOFREADING_HYDRATE_STALE_KEY },
      );
    }

    const chunks = partition_proofreading_hydration_items(input.upsertItems, worker_count);
    const slice_schedulers = ensure_hydration_schedulers(chunks.length);
    const slice_results = await Promise.all(
      chunks.map((upsertItems, index) => {
        const slice_scheduler = slice_schedulers[index] ?? scheduler;
        return slice_scheduler.submit<ProofreadingRuntimeEvaluatedSliceResult>(
          {
            type: "proofreading.evaluate_hydration_slice",
            input: {
              ...input,
              upsertItems,
            },
          },
          { priority: "normal", staleKey: PROOFREADING_HYDRATE_STALE_KEY },
        );
      }),
    );

    return await scheduler.submit(
      {
        type: "proofreading.hydrate_evaluated_full",
        input: {
          projectId: input.projectId,
          revisions: { ...input.revisions },
          total_item_count: input.total_item_count,
          quality: input.quality,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          rawItems: slice_results.flatMap((result) => result.rawItems),
          evaluatedItems: slice_results.flatMap((result) => result.evaluatedItems),
        },
      },
      { priority: "normal", staleKey: PROOFREADING_HYDRATE_STALE_KEY },
    );
  };

  return {
    hydrate_proofreading_full(input) {
      return hydrate_proofreading_full(input);
    },
    apply_proofreading_item_delta(input) {
      return scheduler.submit(
        {
          type: "proofreading.apply_item_delta",
          input,
        },
        { priority: "normal" },
      );
    },
    build_proofreading_list_view(input, options = {}) {
      return scheduler.submit(
        {
          type: "proofreading.build_list_view",
          input,
        },
        { priority: "foreground", staleKey: options.staleKey ?? "proofreading:list_view" },
      );
    },
    read_proofreading_list_window(input) {
      return scheduler.submit(
        {
          type: "proofreading.read_list_window",
          input,
        },
        { priority: "foreground", staleKey: "proofreading:list_window" },
      );
    },
    read_proofreading_row_ids_range(input) {
      return scheduler.submit(
        {
          type: "proofreading.read_row_ids_range",
          input,
        },
        { priority: "foreground" },
      );
    },
    resolve_proofreading_row_index(input) {
      return scheduler.submit(
        {
          type: "proofreading.resolve_row_index",
          input,
        },
        { priority: "foreground", staleKey: "proofreading:row_index" },
      );
    },
    read_proofreading_items_by_row_ids(input) {
      return scheduler.submit(
        {
          type: "proofreading.read_items_by_row_ids",
          input,
        },
        { priority: "foreground" },
      );
    },
    build_proofreading_filter_panel(input) {
      return scheduler.submit(
        {
          type: "proofreading.build_filter_panel",
          input,
        },
        { priority: "normal", staleKey: "proofreading:filter_panel" },
      );
    },
    compute_quality_statistics(input, options = {}) {
      return scheduler.submit(
        {
          type: "quality.compute_statistics",
          input,
        },
        {
          priority: options.priority ?? "background",
          staleKey: options.staleKey ?? null,
        },
      );
    },
    dispose_project(projectId) {
      [scheduler, ...hydration_schedulers].forEach((worker_scheduler) => {
        worker_scheduler.invalidate_stale_key(PROOFREADING_HYDRATE_STALE_KEY);
      });
      return Promise.all(
        [scheduler, ...hydration_schedulers].map((worker_scheduler) => {
          return worker_scheduler.submit(
            {
              type: "project.dispose",
              input: {
                projectId,
              },
            },
            { priority: "foreground" },
          );
        }),
      ).then(() => undefined);
    },
    dispose() {
      scheduler.dispose();
      hydration_schedulers.forEach((worker_scheduler) => {
        worker_scheduler.dispose();
      });
      hydration_schedulers.length = 0;
    },
  };
}

function resolve_renderer_available_parallelism(): number {
  return typeof navigator === "undefined" ? 1 : (navigator.hardwareConcurrency ?? 1);
}

function resolve_proofreading_hydrate_worker_count(args: {
  item_count: number;
  configured_worker_count?: number;
}): number {
  if (args.item_count <= 1) {
    return 1;
  }

  const default_worker_count = resolve_default_worker_count({
    workerCount: args.configured_worker_count,
    availableParallelism: resolve_renderer_available_parallelism(),
  });
  const useful_worker_count = Math.ceil(
    args.item_count / PROOFREADING_HYDRATE_MIN_ITEMS_PER_WORKER,
  );
  return Math.max(
    1,
    Math.min(
      PROOFREADING_HYDRATE_WORKER_LIMIT,
      default_worker_count,
      useful_worker_count,
      args.item_count,
    ),
  );
}

function partition_proofreading_hydration_items<T>(items: T[], worker_count: number): T[][] {
  const chunk_count = Math.min(worker_count, items.length);
  const chunk_size = Math.ceil(items.length / chunk_count);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunk_size) {
    chunks.push(items.slice(index, index + chunk_size));
  }
  return chunks;
}

/**
 * 获取 renderer 全局共享的 Project UI Worker client，避免每个页面各自创建后台通道。
 */
export function getSharedProjectUiWorkerClient(): ProjectUiWorkerClient {
  if (shared_project_ui_worker_client === null) {
    shared_project_ui_worker_client = createProjectUiWorkerClient();
  }

  return shared_project_ui_worker_client;
}

/**
 * 测试专用重置入口，避免跨用例复用已终止或已缓存的 worker client。
 */
export function resetSharedProjectUiWorkerClientForTest(): void {
  shared_project_ui_worker_client?.dispose();
  shared_project_ui_worker_client = null;
}
