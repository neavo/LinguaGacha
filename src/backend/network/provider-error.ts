import { is_json_record } from "../../domain/json";
import { AppError, type AppErrorDiagnosticContext } from "../../shared/error";

/** 只提取接口的错误消息和机器字段，避免把 token 响应或请求内容整包传给界面。 */
export function create_provider_error(
  value: unknown,
  status?: number,
  context: AppErrorDiagnosticContext = {},
): AppError {
  const data = is_json_record(value) ? value : {};
  const detail = is_json_record(data["error"]) ? data["error"] : data;
  const code = typeof data["error"] === "string" ? data["error"] : detail["code"];
  const message =
    [
      data["error_description"],
      detail["message"],
      data["detail"],
      value instanceof Error ? value.message : value,
      code,
    ].find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
    ) ?? (status === undefined ? "Model request failed." : `HTTP ${status}`);
  const error = new AppError("model.provider_failed", {
    message,
    public_details: status === undefined ? {} : { status },
    diagnostic_context: { ...context, status, provider_code: code, param: detail["param"] },
    ...(value instanceof Error ? { cause: value } : {}),
  });
  return error;
}

/** 非成功响应既可能是 JSON，也可能是纯文本；错误提取只消费响应体一次。 */
export async function read_provider_response_error(
  response: Response,
  context: AppErrorDiagnosticContext = {},
): Promise<AppError> {
  const text = await response.text();
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* 非 JSON 错误保留原文。 */
  }
  return create_provider_error(value, response.status, context);
}
