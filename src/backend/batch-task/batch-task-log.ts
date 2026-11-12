import type { JsonRecord } from "../../domain/json";
import { Model } from "../../domain/model";
import type { LogError } from "../../shared/error";
import type { TextResolver } from "../../shared/i18n";
import type { LogManager } from "../log/log-manager";

const API_FORMAT_NAMES = {
  OpenAI: "OpenAI Chat",
  OpenAIResponses: "OpenAI Responses",
  SakuraLLM: "SakuraLLM",
  Google: "Google",
  Anthropic: "Anthropic",
} as const; // 日志展示协议名称，配置仍使用原有格式标识。

/** 四项接口信息连续输出，最后一项结束控制台日志组。 */
export function log_batch_task_start(
  log: Pick<LogManager, "append">,
  source: string,
  model: JsonRecord,
  t: TextResolver,
): void {
  const rows = [
    [t("app.log.provider"), String(model["name"] ?? "")],
    [t("app.log.api_type"), API_FORMAT_NAMES[Model.normalize_api_format(model["api_format"])]],
    [t("app.log.api_url"), String(model["api_url"] ?? "")],
    [t("app.log.model_id"), String(model["model_id"] ?? "")],
  ];
  rows.forEach(([label, value], index) =>
    log.append({
      level: "info",
      source,
      content: `${label} - ${value}`,
      console_group_end: index === rows.length - 1,
    }),
  );
}

/** 可读正文保持单行，完整异常仍保存在日志详情中。 */
export function log_batch_request_failure(
  log: Pick<LogManager, "append">,
  source: string,
  key_index: number,
  error: LogError,
  t: TextResolver,
): void {
  log.append({
    level: "warning",
    source,
    error,
    content: {
      kind: "text",
      text: t("app.log.request_key_failed", { KEY: String(key_index + 1), ERROR: error.message }),
    },
  });
}
