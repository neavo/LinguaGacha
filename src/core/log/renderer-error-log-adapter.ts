import {
  error_diagnostic_to_log_fields,
  type ErrorDiagnosticContext,
  type ErrorDiagnosticLogFields,
  type RendererErrorReport,
} from "../../shared/error";

/**
 * LogManager 只消费统一错误字段，renderer 触发事件和上下文统一合并进 context。
 */
export function renderer_error_report_to_log_fields(
  report: RendererErrorReport,
): ErrorDiagnosticLogFields {
  const diagnostic_fields = error_diagnostic_to_log_fields(report.diagnostic);
  const context: ErrorDiagnosticContext = {
    renderer_source: report.source,
    ...diagnostic_fields.context,
    ...(report.route === undefined ? {} : { route: report.route }),
    ...(report.project === undefined ? {} : { project: report.project }),
    ...(report.task === undefined ? {} : { task: report.task }),
    ...(report.triggeringEvent === undefined ? {} : { triggeringEvent: report.triggeringEvent }),
    ...(report.context === undefined ? {} : { renderer_context: report.context }),
  };
  return {
    error_message: diagnostic_fields.error_message,
    ...(diagnostic_fields.stack === undefined ? {} : { stack: diagnostic_fields.stack }),
    context,
  };
}
