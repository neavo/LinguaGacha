import { describe, expect, it } from "vitest";

import { normalize_renderer_error_report } from "../../shared/error";
import { renderer_error_report_to_log_fields } from "./renderer-error-log-adapter";

describe("renderer error log adapter", () => {
  it("renderer 异常报告映射日志字段时合并诊断和触发上下文", () => {
    const report = normalize_renderer_error_report({
      source: "worker",
      diagnostic: {
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

    expect(renderer_error_report_to_log_fields(report)).toEqual({
      error_message: "worker 爆炸",
      context: {
        renderer_source: "worker",
        error_name: "Error",
        worker_message_type: "quality.compute_statistics",
        route: "proofreading",
        renderer_context: {
          page: "proofreading",
        },
      },
    });
  });
});
