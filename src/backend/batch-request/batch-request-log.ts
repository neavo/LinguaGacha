import { is_json_record, type JsonRecord } from "../../domain/json";
import type { LogResultContent, LogTextSection } from "../../shared/log";
import type { create_text_resolver } from "../../shared/i18n";
import type { LLMRequestFacts } from "../llm/llm-types";

type TextResolver = ReturnType<typeof create_text_resolver>;

/** 日志只保留文字与媒体元数据，避免 Base64 淹没日志。 */
function message_text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(is_json_record)
    .map((part) =>
      part["type"] === "text"
        ? String(part["text"] ?? "")
        : `[${String(part["type"])}: ${String(part["mime_type"])}]`,
    )
    .join("\n");
}

/** 服务提供已经结算的事实，正文组织不接管批次状态或文件发布。 */
export function build_batch_request_result_log(input: {
  run_id: string;
  request_id: string;
  started_at: number;
  payload: JsonRecord | undefined;
  result: (LLMRequestFacts & { response: JsonRecord | null }) | undefined;
  error: string | null;
  result_file: string | null;
  t: TextResolver;
}): LogResultContent {
  const { t, result } = input;
  const ended_at = Date.now();
  const sections: LogTextSection[] = [];
  const messages = input.payload?.["messages"];
  if (Array.isArray(messages))
    sections.push({
      title: t("app.log.request_messages"),
      text: messages
        .filter(is_json_record)
        .map((message) => `${String(message["role"])}: ${message_text(message["content"])}`)
        .join("\n\n"),
    });
  for (const [field, title] of [
    ["thinking", t("app.log.thinking_process")],
    ["text", t("app.log.model_response")],
  ] as const) {
    const text = result?.response?.[field];
    if (typeof text === "string" && text.trim() !== "") sections.push({ title, text });
  }
  return {
    kind: "request_result",
    run_id: input.run_id,
    request_id: input.request_id,
    started_at: new Date(input.started_at).toISOString(),
    ended_at: new Date(ended_at).toISOString(),
    summary: [
      `${input.run_id} / ${input.request_id}`,
      t("app.log.task_stats", {
        COUNT: "1",
        TIME: ((ended_at - input.started_at) / 1000).toFixed(2),
        PT: String(result?.input_tokens ?? 0),
        RT: String(result?.reasoning_tokens ?? 0),
        CT: String(result?.output_tokens ?? 0),
      }),
      ...(input.error === null ? [] : [t("app.log.request_failed", { ERROR: input.error })]),
      ...(input.result_file === null ? [] : [input.result_file]),
    ],
    sections,
  };
}
