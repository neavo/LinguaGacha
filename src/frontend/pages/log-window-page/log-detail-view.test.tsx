import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { LogDetailView } from "@frontend/pages/log-window-page/log-detail-view";

describe("LogDetailView", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("结构化摘要显示用户错误且诊断区只显示调用栈", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <LocaleProvider locale="zh-CN">
          <LogDetailView
            detail={{
              id: "log-1",
              sequence: 1,
              created_at: "2026-08-30T00:00:00.000Z",
              level: "error",
              source: "engine-worker",
              content: {
                kind: "translation_result",
                summary: ["用户可见摘要"],
                sections: [],
                pairs: [],
              },
              error: {
                message: "不应单独展示的错误消息",
                stack: "ProviderError\n    at request",
              },
            }}
          />
        </LocaleProvider>,
      );
    });

    expect(container.querySelector(".log-detail-view__summary")?.textContent).toContain(
      "用户可见摘要",
    );
    expect(container.querySelector(".log-detail-view__error pre")?.textContent).toBe(
      "ProviderError\n    at request",
    );
    expect(container.textContent).not.toContain("不应单独展示的错误消息");
  });
});
