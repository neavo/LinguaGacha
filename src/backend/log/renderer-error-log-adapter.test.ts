import { describe, expect, it } from "vitest";

import { normalize_renderer_error_report } from "../../shared/error";
import { renderer_error_report_to_log_payload } from "./renderer-error-log-adapter";

describe("renderer error log adapter", () => {
  it("renderer 异常报告映射日志载荷时合并错误和触发上下文", () => {
    const report = normalize_renderer_error_report({
      source: "worker",
      error: {
        name: "Error",
        message: "worker 爆炸",
        context: {
          worker_message_type: "quality.compute_statistics",
        },
      },
      route: "proofreading",
      context: {
        page: "proofreading",
      },
    });

    expect(renderer_error_report_to_log_payload(report)).toEqual({
      error: {
        name: "Error",
        message: "worker 爆炸",
        context: {
          worker_message_type: "quality.compute_statistics",
        },
      },
      context: {
        renderer_source: "worker",
        route: "proofreading",
        renderer_context: {
          page: "proofreading",
        },
      },
    });
  });
});
