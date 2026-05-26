import type { LogErrorContext, RendererErrorReport } from "../../shared/error";

/**
 * LogManager 只消费 error 对象，renderer 触发事件和上下文统一合并进 error.context。
 */
export function renderer_error_report_to_log_payload(report: RendererErrorReport): {
  error: RendererErrorReport["error"];
  context: LogErrorContext;
} {
  return {
    error: report.error,
    context: {
      renderer_source: report.source,
      ...(report.route === undefined ? {} : { route: report.route }),
      ...(report.project === undefined ? {} : { project: report.project }),
      ...(report.task === undefined ? {} : { task: report.task }),
      ...(report.triggeringEvent === undefined ? {} : { triggeringEvent: report.triggeringEvent }),
      ...(report.context === undefined ? {} : { renderer_context: report.context }),
    },
  };
}
