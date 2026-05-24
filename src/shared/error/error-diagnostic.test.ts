import { describe, expect, it } from "vitest";

import {
  error_diagnostic_from_message,
  error_diagnostic_to_log_fields,
  sanitize_error_diagnostic_context,
  normalize_error_diagnostic,
  summarize_diagnostic_path,
  summarize_diagnostic_url,
  to_error_diagnostic,
} from "./error-diagnostic";

describe("error diagnostic", () => {
  it("把 Error 归一为可跨边界传递的结构化诊断", () => {
    const error = new Error("供应商爆炸", {
      cause: new Error("底层连接失败"),
    });
    error.stack = "Error: 供应商爆炸\n    at request";

    const diagnostic = to_error_diagnostic(error, {
      provider: "openai-compatible",
      retries: 2,
      progress: {
        value: Number.POSITIVE_INFINITY,
      },
    });

    expect(diagnostic).toMatchObject({
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
    const diagnostic = error_diagnostic_from_message(
      "请求失败\n    at Provider.request\n    at run",
    );

    expect(diagnostic).toEqual({
      message: "请求失败",
      stack: "at Provider.request\n    at run",
    });
  });

  it("跨线程坏载荷会降级为稳定 fallback 诊断", () => {
    expect(normalize_error_diagnostic({ message: "" }, "worker 执行失败")).toEqual({
      message: "worker 执行失败",
    });
    expect(normalize_error_diagnostic("boom", "worker 执行失败")).toEqual({
      message: "worker 执行失败",
    });
  });

  it("映射日志字段时保持 message 摘要和异常细节分离", () => {
    const fields = error_diagnostic_to_log_fields({
      name: "ProviderError",
      message: "供应商爆炸",
      stack: "ProviderError: 供应商爆炸",
      context: {
        provider: "demo",
      },
    });

    expect(fields).toEqual({
      error_message: "供应商爆炸",
      stack: "ProviderError: 供应商爆炸",
      context: {
        provider: "demo",
        error_name: "ProviderError",
      },
    });
  });

  it("路径摘要由调用边界显式构造", () => {
    const context = sanitize_error_diagnostic_context({
      projectPath: summarize_diagnostic_path("E:/secret/project/demo.lg"),
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

  it("归一化既有诊断时保留边界传入的路径摘要值对象", () => {
    const diagnostic = normalize_error_diagnostic(
      {
        message: "worker 爆炸",
        context: {
          projectPath: summarize_diagnostic_path("E:/secret/project/demo.lg"),
        },
      },
      "worker 执行失败",
    );

    expect(diagnostic.context).toMatchObject({
      projectPath: {
        basename: "demo.lg",
        pathHash: expect.any(String),
        length: 25,
      },
    });
  });

  it("URL 摘要不暴露原始路径、query 或 hash", () => {
    const summary = summarize_diagnostic_url(
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

  it("保留调用边界定义的诊断字段并裁剪为 JSON 值", () => {
    const context = sanitize_error_diagnostic_context({
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
