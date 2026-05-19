import type {
  ProofreadingFilterPanelQuery,
  ProofreadingItemsByRowIdsQuery,
  ProofreadingListViewQuery,
  ProofreadingListWindowQuery,
  ProofreadingRowIdsRangeQuery,
  ProofreadingRuntimeDeltaInput,
  ProofreadingRuntimeHydrationInput,
} from "@/project/worker/proofreading-ui-worker-service";
import type { QualityStatisticsTaskInput } from "@/project/quality/quality-statistics";

// Project UI Worker 协议只承载 renderer 项目 UI 派生任务，不表达项目事实写入。
export type ProjectUiWorkerRequest =
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "proofreading.hydrate_full"; // type 是 worker 入口分发的唯一判别字段
      input: ProofreadingRuntimeHydrationInput; // input 是校对 UI 派生缓存的全量快照
    }
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "proofreading.apply_item_delta"; // type 是 worker 入口分发的唯一判别字段
      input: ProofreadingRuntimeDeltaInput; // input 是 ProjectStore item 变化的增量载荷
    }
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "proofreading.build_list_view"; // type 是 worker 入口分发的唯一判别字段
      input: ProofreadingListViewQuery; // input 是列表搜索、排序和筛选查询
    }
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "proofreading.read_list_window"; // type 是 worker 入口分发的唯一判别字段
      input: ProofreadingListWindowQuery; // input 是当前列表视图的分页窗口查询
    }
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "proofreading.read_row_ids_range"; // type 是 worker 入口分发的唯一判别字段
      input: ProofreadingRowIdsRangeQuery; // input 是批量选择需要读取的 row id 范围
    }
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "proofreading.read_items_by_row_ids"; // type 是 worker 入口分发的唯一判别字段
      input: ProofreadingItemsByRowIdsQuery; // input 是按 row id 回读 worker 缓存条目的查询
    }
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "proofreading.build_filter_panel"; // type 是 worker 入口分发的唯一判别字段
      input: ProofreadingFilterPanelQuery; // input 是筛选面板统计查询
    }
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "quality.compute_statistics"; // type 是 worker 入口分发的唯一判别字段
      input: QualityStatisticsTaskInput; // input 是质量规则统计 worker 任务
    }
  | {
      id: number; // id 由 scheduler 分配，用于把 worker 回包配对到 in-flight 请求
      type: "project.dispose"; // type 是 worker 入口分发的唯一判别字段
      input: {
        projectId: string; // projectId 指定要释放的项目级派生缓存
      };
    };

// RequestPayload 是 client 提交时的载荷形状，id 始终由 scheduler 统一补齐。
export type ProjectUiWorkerRequestPayload = ProjectUiWorkerRequest extends infer TRequest
  ? TRequest extends { id: number }
    ? Omit<TRequest, "id">
    : never
  : never;

// worker response 使用统一 ok 壳，client 再映射为稳定错误码或具体结果类型。
export type ProjectUiWorkerResponse =
  | {
      id: number; // id 与请求 id 一致，用于 scheduler 只完成当前 in-flight 任务
      ok: true; // ok=true 表示 result 可按调用方泛型收窄
      result: unknown; // result 由 client 方法的返回类型在调用侧约束
    }
  | {
      id: number; // id 与请求 id 一致，用于 scheduler 只完成当前 in-flight 任务
      ok: false; // ok=false 表示 worker 侧执行失败
      error: string; // error 仅作诊断文本，client 会映射为稳定错误码
    };
