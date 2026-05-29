import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  capture_renderer_error,
  install_renderer_global_error_handlers,
  update_renderer_diagnostics_context,
} from "@frontend/app/diagnostics/renderer-error-reporter";

// report renderer error mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const report_renderer_error_mock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    report_renderer_error: report_renderer_error_mock,
  };
});

describe("renderer error reporter", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "desktopApp");
    report_renderer_error_mock.mockClear();
    update_renderer_diagnostics_context({});
  });

  it("只在实际捕获异常时上报当前 renderer 诊断上下文", () => {
    update_renderer_diagnostics_context({
      route: "workbench",
      project: {
        loaded: true,
        path: "E:/demo/demo.lg",
      },
      task: {
        status: "running",
        runRevision: 7,
      },
    });

    capture_renderer_error(new Error("批量应用失败"), {
      source: "scheduler",
      triggeringEvent: {
        topic: "project.data_changed",
        updatedSections: ["items"],
      },
    });

    expect(report_renderer_error_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "scheduler",
        error: expect.objectContaining({
          message: "批量应用失败",
        }),
        route: "workbench",
        project: {
          loaded: true,
          path: {
            basename: "demo.lg",
            pathHash: expect.any(String),
            length: 15,
          },
        },
        task: {
          status: "running",
          runRevision: 7,
        },
        triggeringEvent: {
          topic: "project.data_changed",
          updatedSections: ["items"],
        },
      }),
    );
  });

  it("短时间重复捕获同一个异常时只写一条诊断", () => {
    const error = new Error("重复异常");

    capture_renderer_error(error, { source: "global", dedupeKey: "same-error" });
    capture_renderer_error(error, { source: "global", dedupeKey: "same-error" });

    expect(report_renderer_error_mock).toHaveBeenCalledTimes(1);
  });

  it("全局浏览器异常只上报路径和 URL 摘要", () => {
    const uninstall = install_renderer_global_error_handlers();

    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("全局爆炸"),
        filename: "E:/secret/app/renderer.js",
        lineno: 12,
        colno: 5,
      }),
    );
    uninstall();

    expect(report_renderer_error_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "global",
        error: expect.objectContaining({
          message: "全局爆炸",
        }),
        context: expect.objectContaining({
          eventKind: "error",
          filename: {
            basename: "renderer.js",
            pathHash: expect.any(String),
            length: 25,
          },
          line: 12,
          column: 5,
          location: expect.objectContaining({
            hrefHash: expect.any(String),
            length: expect.any(Number),
          }),
        }),
      }),
    );
    const last_call = report_renderer_error_mock.mock.calls.at(-1) as
      | [Record<string, unknown>]
      | undefined;
    if (last_call === undefined) {
      throw new Error("缺少 renderer error 上报。");
    }
    expect(JSON.stringify(last_call[0].context)).not.toContain("secret");
  });

  it("显式传入 worker 结构化诊断时保留原始失败快照", () => {
    capture_renderer_error(new Error("project_ui_worker_execution_failed"), {
      source: "worker",
      logError: {
        name: "Error",
        message: "worker 爆炸",
        stack: "Error: worker 爆炸\n    at run",
        context: {
          worker_message_type: "quality.compute_statistics",
        },
      },
      context: {
        page: "proofreading",
      },
    });

    expect(report_renderer_error_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "worker",
        error: expect.objectContaining({
          message: "worker 爆炸",
          context: {
            worker_message_type: "quality.compute_statistics",
          },
        }),
        context: {
          page: "proofreading",
        },
      }),
    );
  });

  it("诊断上下文更新时同步写入 main 侧黑匣子桥接", () => {
    const report_renderer_diagnostics = vi.fn();
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: {
        reportRendererDiagnostics: report_renderer_diagnostics,
      },
    });

    update_renderer_diagnostics_context({
      route: "workbench",
      task: {
        status: "running",
      },
    });

    expect(report_renderer_diagnostics).toHaveBeenCalledWith({
      route: "workbench",
      project: undefined,
      task: {
        status: "running",
      },
    });
  });
});
