import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppEditor } from "@frontend/widgets/app-editor/app-editor";

vi.mock("next-themes", () => {
  return {
    useTheme: () => {
      return {
        resolvedTheme: "light",
      };
    },
  };
});

function get_editor_content(container: HTMLElement): HTMLElement {
  const content = container.querySelector<HTMLElement>(".cm-content");
  if (content === null) {
    throw new Error("缺少编辑器内容节点。");
  }

  return content;
}

function dispatch_tab_key(content: HTMLElement): boolean {
  content.focus();
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    code: "Tab",
    bubbles: true,
    cancelable: true,
  });

  content.dispatchEvent(event);

  return event.defaultPrevented;
}

describe("AppEditor", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it("字段形态使用同一套 CodeMirror 标记且不渲染行号槽", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor
          variant="field"
          value="虎鉄123"
          aria_label="译文姓名"
          read_only={false}
          aria_invalid
          marks={[{ start: 0, end: 2, tone: "success", tooltip: "虎鉄 -> 虎铁" }]}
        />,
      );
    });

    const editor = container.querySelector(".app-editor--field");
    const content = container.querySelector<HTMLElement>(".cm-content[aria-label='译文姓名']");

    expect(editor).not.toBeNull();
    expect(content?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector(".cm-gutters")).toBeNull();
    expect(container.querySelector(".app-text-mark--success")?.textContent).toBe("虎鉄");
  });

  it("字段形态会把外部多行值归一成单行", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor variant="field" value={"Alice\r\nBob"} aria_label="原文姓名" read_only />,
      );
    });

    expect(container.querySelector(".cm-content")?.textContent).toBe("Alice Bob");
  });

  it("默认使用 Tab 缩进", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AppEditor value="Alpha" aria_label="默认编辑器" read_only={false} />);
    });

    expect(dispatch_tab_key(get_editor_content(container))).toBe(true);
  });

  it("关闭 Tab 缩进后把 Tab 交回浏览器焦点链路", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor
          value="Alpha"
          aria_label="质量规则字段"
          read_only={false}
          indent_with_tab={false}
        />,
      );
    });

    expect(dispatch_tab_key(get_editor_content(container))).toBe(false);
  });

  it("更新 Tab 缩进属性后同步重配键盘映射", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppEditor
          value="Alpha"
          aria_label="可重配编辑器"
          read_only={false}
          indent_with_tab={false}
        />,
      );
    });

    expect(dispatch_tab_key(get_editor_content(container))).toBe(false);

    await act(async () => {
      root?.render(
        <AppEditor value="Alpha" aria_label="可重配编辑器" read_only={false} indent_with_tab />,
      );
    });

    expect(dispatch_tab_key(get_editor_content(container))).toBe(true);
  });
});
