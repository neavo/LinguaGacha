import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { LogContent } from "@shared/log";
import type { LogError } from "@shared/error";

vi.mock("@frontend/app/appearance/appearance-context", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));

import { LogDetailView } from "./log-detail-view";

describe("LogDetailView", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  /** 公共挂载只补齐详情元数据，用例明确提供需要观察的正文和错误。 */
  function render_detail(content: LogContent, error?: LogError): HTMLDivElement {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TooltipProvider>
          <LocaleProvider locale="zh-CN">
            <LogDetailView
              detail={{
                id: "log-1",
                date: "20260913",
                revision: "rev",
                line: 1,
                created_at: "2026-09-13T00:00:01.000Z",
                level: "info",
                source: "test",
                content,
                ...(error === undefined ? {} : { error }),
              }}
            />
          </LocaleProvider>
        </TooltipProvider>,
      );
    });
    return container;
  }

  it("结构化摘要显示用户错误且诊断区只显示调用栈", () => {
    const view = render_detail(
      {
        kind: "translation_result",
        started_at: "2026-09-13T00:00:00.000Z",
        ended_at: "2026-09-13T00:00:01.000Z",
        summary: ["用户可见摘要"],
        sections: [],
        pairs: [],
      },
      { message: "不应单独展示的错误消息", stack: "ProviderError\n    at request" },
    );
    expect(view.querySelector(".log-detail-view__summary")?.textContent).toContain("用户可见摘要");
    expect(view.querySelector(".log-detail-view__error pre")?.textContent).toBe(
      "ProviderError\n    at request",
    );
    expect(view.textContent).not.toContain("不应单独展示的错误消息");
  });

  it("AGENT 结构化正文进入详情编辑器", () => {
    const view = render_detail({
      kind: "agent",
      event: "message",
      parts: [{ kind: "text", text: "任务已经完成" }],
    });
    expect(view.querySelector(".cm-content")?.textContent).toContain("任务已经完成");
  });

  it("普通错误详情显示原始原因和诊断字段", () => {
    const view = render_detail("创建工程失败", {
      message: "database.busy",
      cause_chain: [{ message: "database is locked" }],
      context: { operation: "journal_mode", sqlite_code: 5 },
    });
    const text = view.querySelector(".cm-content")?.textContent;
    expect(text).toContain("database is locked");
    expect(text).toContain("journal_mode");
    expect(text).toContain("sqlite_code");
  });
});
