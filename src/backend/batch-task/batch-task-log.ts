import type { JsonRecord } from "../../domain/json";
import { Model } from "../../domain/model";
import type { LogError } from "../../shared/error";
import type { TextResolver } from "../../shared/i18n";
import type { LogWriter } from "../log/log-manager";

const API_FORMAT_NAMES = {
  OpenAI: "OpenAI Chat",
  OpenAIResponses: "OpenAI Responses",
  SakuraLLM: "SakuraLLM",
  Google: "Google",
  Anthropic: "Anthropic",
} as const; // 日志展示协议名称，配置仍使用原有格式标识。

/** 一条记录写完接口信息，避免并发启动时拆散。 */
export function log_batch_task_start(
  log: Pick<LogWriter, "append">,
  source: string,
  model: JsonRecord,
  t: TextResolver,
): void {
  const rows = [
    `${t("app.log.provider")} - ${String(model["name"] ?? "")}`,
    `${t("app.log.api_type")} - ${API_FORMAT_NAMES[Model.normalize_api_format(model["api_format"])]}`,
    `${t("app.log.api_url")} - ${String(model["api_url"] ?? "")}`,
    `${t("app.log.model_id")} - ${String(model["model_id"] ?? "")}`,
  ];
  log.append({
    level: "info",
    source,
    content: rows.join("\n"),
  });
}

/** 可读正文保持单行，完整异常仍保存在日志详情中。 */
export function log_batch_request_failure(
  log: Pick<LogWriter, "append">,
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
