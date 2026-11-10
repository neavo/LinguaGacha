import { expect, it } from "vitest";
import { create_text_resolver } from "../../shared/i18n";
import { format_log_content_text } from "../../shared/log";
import { build_batch_request_result_log } from "./batch-request-log";

const t = create_text_resolver("en-US");

/** 提供已结算事实，正文投影测试独立于任务调度与文件发布。 */
function result_log(input: Partial<Parameters<typeof build_batch_request_result_log>[0]>) {
  return build_batch_request_result_log({
    run_id: "run",
    request_id: "one",
    started_at: Date.now(),
    format: "messages",
    payload: undefined,
    result: undefined,
    error: null,
    result_file: null,
    t,
    ...input,
  });
}

it("消息日志分离输入、思考与回复，保留成果路径和失败原因", () => {
  const content = result_log({
    payload: { messages: [{ role: "user", content: "question" }] },
    result: {
      response: { thinking: "reasoning", text: "answer" },
      input_tokens: 4,
      reasoning_tokens: 2,
      output_tokens: 6,
      usage_complete: true,
      cancelled: false,
      timeout: false,
    },
    result_file: "/result.json",
  });
  expect(content.sections).toEqual([
    { title: t("app.log.request_messages"), text: "user: question" },
    { title: t("app.log.thinking_process"), text: "reasoning" },
    { title: t("app.log.model_response"), text: "answer" },
  ]);
  expect(content.summary).toContain("/result.json");
  expect(content.summary).not.toContain(t("app.log.usage_incomplete"));
  const failure = format_log_content_text(result_log({ error: "disk failure" }));
  expect(failure).toContain(t("app.log.usage_incomplete"));
  expect(failure).toContain(t("app.log.request_failed", { ERROR: "disk failure" }));
});

it("原生响应只投影已知文字与输出类型，媒体字节和未知字段留在成果中", () => {
  const content = result_log({
    format: "responses",
    result: {
      response: {
        status: "completed",
        secret: "PRIVATE_FIELD",
        output: [
          null,
          {
            type: "message",
            content: [
              { type: "output_text", text: "answer" },
              { type: "refusal", refusal: "refused" },
              { type: "output_audio", data: "MEDIA_BYTES" },
            ],
          },
          { type: "reasoning", summary: [{ type: "summary_text", text: "reasoning" }] },
          { type: "image_generation_call", result: "IMAGE_BYTES" },
        ],
      },
      input_tokens: 0,
      reasoning_tokens: 0,
      output_tokens: 0,
      usage_complete: false,
      cancelled: false,
      timeout: false,
    },
  });
  expect(content.sections).toEqual([
    { title: t("app.log.thinking_process"), text: "reasoning" },
    {
      title: t("app.log.model_response"),
      text: "completed\n\nanswer\n\nrefused\n\noutput_audio\n\nimage_generation_call",
    },
  ]);
});
