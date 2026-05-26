import {
  capture_renderer_error,
  type RendererErrorCaptureOptions,
} from "@/app/diagnostics/renderer-error-reporter";
import { is_project_ui_worker_client_error } from "@/project/worker/project-ui-worker-errors";

export type ProjectUiWorkerErrorCaptureOptions = Omit<
  RendererErrorCaptureOptions,
  "source" | "logError"
>; // source 和 logError 固定由 worker 边界决定，页面只补业务上下文

/**
 * Project UI Worker 失败只在这个边界解包结构化诊断，页面不需要理解 Error 子类细节。
 */
export function capture_project_ui_worker_error(
  error: unknown,
  options: ProjectUiWorkerErrorCaptureOptions,
): boolean {
  if (is_project_ui_worker_client_error(error, "stale")) {
    return false;
  }

  capture_renderer_error(error, {
    ...options,
    source: "worker",
    logError: is_project_ui_worker_client_error(error) ? error.log_error : undefined,
  });
  return true;
}
