import { expect, it, vi } from "vitest";
import { create_text_resolver } from "../../shared/i18n";
import { format_log_readable_text, type LogAppendPayload } from "../../shared/log";
import { log_batch_task_start, log_batch_request_failure } from "./batch-task-log";

const t = create_text_resolver("zh-CN");

it("四项接口信息写入同一条多行记录", () => {
  const append = vi.fn<(entry: LogAppendPayload) => void>();
  log_batch_task_start(
    { append },
    "test",
    {
      name: "provider",
      api_format: "OpenAI",
      api_url: "https://example.test/v1",
      model_id: "model",
    },
    t,
  );
  expect(append).toHaveBeenCalledOnce();
  expect(String(append.mock.calls[0]?.[0].content).split("\n")).toHaveLength(4);
});

it("请求失败保留调用栈，控制台正文只展示简要原因", () => {
  const append = vi.fn<(entry: LogAppendPayload) => void>();
  const error = { message: "rate limited", stack: "provider stack" };
  log_batch_request_failure({ append }, "test", 1, error, t);
  const entry = append.mock.calls[0]![0];
  expect(entry).toMatchObject({ level: "warning", source: "test", error });
  const text = format_log_readable_text({ content: entry.content, error });
  expect(text).toContain(error.message);
  expect(text).not.toContain(error.stack);
});
