import { describe, expect, it } from "vitest";

import {
  log_error_from_message,
  normalize_log_error,
  sanitize_log_error_context,
  summarize_log_error_path,
  summarize_log_error_url,
  to_log_error,
} from "./log-error";

describe("log error", () => {
  it("把 Error 归一为可跨边界传递的结构化错误快照", () => {
    const error = new Error("供应商爆炸") as Error & { cause?: unknown };
    error.cause = new Error("底层连接失败");
    error.stack = "Error: 供应商爆炸\n    at request";

    const log_error = to_log_error(error, {
      provider: "openai-compatible",
      retries: 2,
      progress: {
        value: Number.POSITIVE_INFINITY,
      },
    });

    expect(log_error).toMatchObject({
      name: "Error",
      message: "供应商爆炸",
      stack: "Error: 供应商爆炸\n    at request",
      cause_chain: [
        {
          name: "Error",
          message: "底层连接失败",
        },
      ],
      context: {
        provider: "openai-compatible",
        retries: 2,
        progress: {
          value: "Infinity",
        },
      },
    });
  });

  it("会把误拼进 message 的调用栈拆到 stack 字段", () => {
    const log_error = log_error_from_message("请求失败\n    at Provider.request\n    at run");

    expect(log_error).toEqual({
      message: "请求失败",
      stack: "at Provider.request\n    at run",
    });
  });

  it("跨线程坏载荷会降级为稳定 fallback 错误", () => {
    expect(normalize_log_error({ message: "" }, "worker 执行失败")).toEqual({
      message: "worker 执行失败",
    });
    expect(normalize_log_error("boom", "worker 执行失败")).toEqual({
      message: "worker 执行失败",
    });
  });

  it("路径摘要由调用边界显式构造", () => {
    const context = sanitize_log_error_context({
      projectPath: summarize_log_error_path("E:/secret/project/demo.lg"),
      progress: {
        output_path: "E:/secret/out/result.txt",
      },
    });

    expect(context).toMatchObject({
      projectPath: {
        basename: "demo.lg",
        pathHash: expect.any(String),
        length: 25,
      },
      progress: {
        output_path: "E:/secret/out/result.txt",
      },
    });
  });

  it("归一化既有错误快照时保留边界传入的路径摘要值对象", () => {
    const log_error = normalize_log_error(
      {
        message: "worker 爆炸",
        context: {
          projectPath: summarize_log_error_path("E:/secret/project/demo.lg"),
        },
      },
      "worker 执行失败",
    );

    expect(log_error.context).toMatchObject({
      projectPath: {
        basename: "demo.lg",
        pathHash: expect.any(String),
        length: 25,
      },
    });
  });

  it("URL 摘要不暴露原始路径、query 或 hash", () => {
    const summary = summarize_log_error_url(
      "file:///E:/secret/project/index.html?token=hidden#route",
    );

    expect(summary).toEqual({
      scheme: "file",
      hostHash: expect.any(String),
      pathBasename: "index.html",
      hrefHash: expect.any(String),
      length: 55,
    });
    expect(JSON.stringify(summary)).not.toContain("secret");
    expect(JSON.stringify(summary)).not.toContain("token");
  });

  it("保留调用边界定义的错误上下文字段并裁剪为 JSON 值", () => {
    const context = sanitize_log_error_context({
      error_code: -105,
      error_description: "NAME_NOT_RESOLVED",
      validated_url: "http://127.0.0.1:5173/",
      nested: {
        elapsed_ms: Number.NaN,
      },
      callback: () => "ignored",
    });

    expect(context).toEqual({
      error_code: -105,
      error_description: "NAME_NOT_RESOLVED",
      validated_url: "http://127.0.0.1:5173/",
      nested: {
        elapsed_ms: "NaN",
      },
      callback: expect.any(String),
    });
  });
});
