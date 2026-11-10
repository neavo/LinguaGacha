import { is_json_record, type JsonRecord } from "../../domain/json";
import type { LogResultContent, LogTextSection } from "../../shared/log";
import type { create_text_resolver } from "../../shared/i18n";
import type { LLMRequestFacts } from "../llm/llm-types";

type TextResolver = ReturnType<typeof create_text_resolver>;

/** 原生响应仅投影已知文本结构，媒体字节与未知字段由成果文件承载。 */
function response_sections(response: JsonRecord, t: TextResolver): LogTextSection[] {
  const output: string[] = [];
  const thinking: string[] = [];
  /** 供应商字段按未知输入处理，只接收非空文字。 */
  const add = (parts: string[], text: unknown) => {
    if (typeof text === "string" && text.trim() !== "") parts.push(text);
  };
  add(output, response["status"]);
  if (Array.isArray(response["output"])) {
    for (const item of response["output"]) {
      if (!is_json_record(item)) continue;
      if (item["type"] === "message" && Array.isArray(item["content"])) {
        for (const part of item["content"]) {
          if (!is_json_record(part)) continue;
          if (part["type"] === "output_text") add(output, part["text"]);
          else if (part["type"] === "refusal") add(output, part["refusal"]);
          else add(output, part["type"]);
        }
      } else if (item["type"] === "reasoning" && Array.isArray(item["summary"])) {
        for (const part of item["summary"]) {
          if (is_json_record(part) && part["type"] === "summary_text") add(thinking, part["text"]);
        }
      } else add(output, item["type"]);
    }
  }
  return [
    { title: t("app.log.thinking_process"), text: thinking.join("\n\n") },
    { title: t("app.log.model_response"), text: output.join("\n\n") },
  ].filter((section) => section.text !== "");
}

/** 服务提供已经结算的事实，正文组织不接管批次状态或文件发布。 */
export function build_batch_request_result_log(input: {
  run_id: string;
  request_id: string;
  started_at: number;
  format: "messages" | "responses";
  payload: JsonRecord | undefined;
  result: (LLMRequestFacts & { response: JsonRecord | null }) | undefined;
  error: string | null;
  result_file: string | null;
  t: TextResolver;
}): LogResultContent {
  const { t, result } = input;
  const ended_at = Date.now();
  const sections: LogTextSection[] = [];
  if (input.format === "messages") {
    const messages = input.payload?.["messages"];
    if (Array.isArray(messages))
      sections.push({
        title: t("app.log.request_messages"),
        text: messages
          .filter(is_json_record)
          .map((message) => `${String(message["role"])}: ${String(message["content"])}`)
          .join("\n\n"),
      });
    for (const [field, title] of [
      ["thinking", t("app.log.thinking_process")],
      ["text", t("app.log.model_response")],
    ] as const) {
      const text = result?.response?.[field];
      if (typeof text === "string" && text.trim() !== "") sections.push({ title, text });
    }
  } else if (result?.response != null) sections.push(...response_sections(result.response, t));
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
      ...(result?.usage_complete === true ? [] : [t("app.log.usage_incomplete")]),
      ...(input.error === null ? [] : [t("app.log.request_failed", { ERROR: input.error })]),
      ...(input.result_file === null ? [] : [input.result_file]),
    ],
    sections,
  };
}
