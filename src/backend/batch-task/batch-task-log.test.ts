import { expect, it, vi } from "vitest";
import { create_text_resolver } from "../../shared/i18n";
import { format_log_readable_text, type LogAppendPayload } from "../../shared/log";
import { log_batch_task_start, log_batch_request_failure } from "./batch-task-log";

const t = create_text_resolver("zh-CN");

it("接口信息按字段映射，只有最后一条结束日志组", () => {
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
  expect(append.mock.calls.map(([entry]) => [entry.content, entry.console_group_end])).toEqual([
    [t("app.log.provider") + " - provider", false],
    [t("app.log.api_type") + " - OpenAI Chat", false],
    [t("app.log.api_url") + " - https://example.test/v1", false],
    [t("app.log.model_id") + " - model", true],
  ]);
});

it("请求失败保留诊断，控制台只显示密钥序号与原因", () => {
  const append = vi.fn<(entry: LogAppendPayload) => void>();
  const error = { message: "rate limited", stack: "provider stack" };
  log_batch_request_failure({ append }, "test", 1, error, t);
  const entry = append.mock.calls[0]![0];
  expect(entry).toMatchObject({ level: "warning", source: "test", error });
  expect(format_log_readable_text({ content: entry.content, error })).toBe(
    t("app.log.request_key_failed", { KEY: "2", ERROR: error.message }),
  );
});
