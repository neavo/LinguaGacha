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
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
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

  /** 按逻辑行读取正文，保留 JSON 换行并排除行号与换行按钮。 */
  function read_editor_text(view: HTMLElement): string {
    return [...view.querySelectorAll(".cm-content .cm-line")]
      .map((line) => line.textContent)
      .join("\n");
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

  it("可读正文使用纯文本编辑器，诊断单独展示", () => {
    const text = "译文生成失败 …\n原始原因";
    const view = render_detail(
      { kind: "text", text },
      { message: "原始原因", stack: "Error: 原始原因\n    at generate" },
    );
    expect(read_editor_text(view)).toBe(text);
    expect(view.querySelector(".log-detail-view__error pre")?.textContent).toContain("at generate");
  });

  it("Agent JSON 区分字段与字符串高亮并保留正文语义", () => {
    const content: LogContent = {
      kind: "agent",
      event: "message",
      parts: [{ kind: "text", text: '任务🌸\n  已经完成 "quoted"', payload: '{"ok":true}' }],
    };
    const view = render_detail(content);
    expect(JSON.parse(read_editor_text(view))).toEqual(content);

    // 字段和值的语义区分由此验证，具体配色由公共编辑器拥有。
    const spans = [...view.querySelectorAll<HTMLElement>(".cm-content .cm-line span")];
    const property = spans.find((span) => span.textContent === '"event"');
    const string = spans.find((span) => span.textContent === '"message"');
    expect(property?.className).toBeTruthy();
    expect(string?.className).toBeTruthy();
    expect(property?.className).not.toBe(string?.className);
  });

  it("切换到普通错误文本撤销 JSON 高亮并显示诊断字段", () => {
    const view = render_detail({ kind: "agent", event: "message" });
    const text = '创建工程失败 {"event":"message"}';
    render_detail(text, {
      message: "database.busy",
      cause_chain: [{ message: "database is locked" }],
      context: { operation: "journal_mode", sqlite_code: 5 },
    });

    const result = read_editor_text(view);
    for (const part of [
      text,
      "database.busy",
      "database is locked",
      "journal_mode",
      "sqlite_code",
    ]) {
      expect(result).toContain(part);
    }
    expect(
      [...view.querySelectorAll(".cm-content .cm-line span")].some(
        (span) => span.textContent === '"event"' || span.textContent === '"message"',
      ),
    ).toBe(false);
  });

  it("Agent 附加诊断完整显示且不进入 JSON 正文", () => {
    const content: LogContent = { kind: "agent", event: "run_end", status: "error" };
    const view = render_detail(content, {
      message: "调用失败",
      stack: "ProviderError\n    at request",
      cause_chain: [{ message: "connection closed", context: { phase: "read" } }],
      context: { request_id: "request-1" },
    });

    expect(JSON.parse(read_editor_text(view))).toEqual(content);
    const diagnostics = view.querySelector(".log-detail-view__error pre")?.textContent;
    for (const text of ["ProviderError", "at request", "connection closed", "read", "request-1"]) {
      expect(diagnostics).toContain(text);
    }
  });
});
