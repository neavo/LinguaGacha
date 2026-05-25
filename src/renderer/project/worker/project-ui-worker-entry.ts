import { run_quality_statistics_task } from "@/project/quality/quality-statistics";
import { createProofreadingUiWorkerService } from "@/project/worker/proofreading-ui-worker-service";
import type {
  ProjectUiWorkerRequest,
  ProjectUiWorkerResponse,
} from "@/project/worker/project-ui-worker-protocol";
import { to_error_diagnostic } from "@shared/error";

const worker_scope = self; // worker_scope 保留 DedicatedWorkerGlobalScope 语义，避免和 window 全局混淆
const proofreading_service = createProofreadingUiWorkerService(); // 单 worker 内共享校对派生缓存，按 project.dispose 显式释放

/**
 * 执行 Project UI Worker 协议请求；入口只做分发，具体派生逻辑留在各服务内维护。
 */
async function execute_project_ui_worker_request(
  request: ProjectUiWorkerRequest,
): Promise<unknown> {
  if (request.type === "proofreading.hydrate_full") {
    return proofreading_service.hydrate_full(request.input);
  }
  if (request.type === "proofreading.apply_item_delta") {
    return proofreading_service.apply_item_delta(request.input);
  }
  if (request.type === "proofreading.build_list_view") {
    return proofreading_service.build_list_view(request.input);
  }
  if (request.type === "proofreading.read_list_window") {
    return proofreading_service.read_list_window(request.input);
  }
  if (request.type === "proofreading.read_row_ids_range") {
    return proofreading_service.read_row_ids_range(request.input);
  }
  if (request.type === "proofreading.resolve_row_index") {
    return proofreading_service.resolve_row_index(request.input);
  }
  if (request.type === "proofreading.read_items_by_row_ids") {
    return proofreading_service.read_items_by_row_ids(request.input);
  }
  if (request.type === "proofreading.build_filter_panel") {
    return proofreading_service.build_filter_panel(request.input);
  }
  if (request.type === "quality.compute_statistics") {
    return await run_quality_statistics_task(request.input);
  }

  proofreading_service.dispose_project(request.input.projectId);
  return null;
}

// 消息处理器负责把所有异常压回协议响应，避免 worker 未捕获异常中断共享通道。
worker_scope.addEventListener("message", (event: MessageEvent<ProjectUiWorkerRequest>) => {
  const request = event.data;
  void (async (): Promise<void> => {
    try {
      const result = await execute_project_ui_worker_request(request);
      const response: ProjectUiWorkerResponse = {
        id: request.id,
        ok: true,
        result,
      };
      worker_scope.postMessage(response);
    } catch (error) {
      const response: ProjectUiWorkerResponse = {
        id: request.id,
        ok: false,
        error_diagnostic: to_error_diagnostic(error, {
          worker_message_type: request.type,
        }),
      };
      worker_scope.postMessage(response);
    }
  })();
});

export {};
