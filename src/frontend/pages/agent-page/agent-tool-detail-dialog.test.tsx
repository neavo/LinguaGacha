import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentToolEntry } from "@shared/agent";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import { AgentToolDetailDialog } from "./agent-tool-detail-dialog";

describe("AgentToolDetailDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render_dialog(entry: AgentToolEntry): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => {
      root?.render(
        <TooltipProvider>
          <AgentToolDetailDialog entry={entry} on_close={vi.fn()} />
        </TooltipProvider>,
      );
    });
  }

  it("完成工具默认只挂载格式化输出，并可切换到输入", async () => {
    await render_dialog(tool_success('{"search":{"keywords":["Alice"]}}', '{"items":[]}'));

    const dialog = document.body.querySelector('[role="dialog"]');
    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const input_tab = tabs.find((tab) => tab.textContent === "agent_page.tool.input");
    const output_tab = tabs.find((tab) => tab.textContent === "agent_page.tool.output");
    expect(output_tab?.getAttribute("data-state")).toBe("active");
    const output = dialog?.querySelector<HTMLElement>(
      ".cm-content[aria-label='agent_page.tool.output']",
    );
    expect(JSON.parse(output?.textContent ?? "")).toEqual({ items: [] });
    expect(output?.querySelector(".cm-line span")).not.toBeNull();
    expect(dialog?.textContent).not.toContain("Alice");

    await act(async () =>
      input_tab?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }),
      ),
    );
    expect(input_tab?.getAttribute("data-state")).toBe("active");
    const input = dialog?.querySelector<HTMLElement>(
      ".cm-content[aria-label='agent_page.tool.input']",
    );
    expect(JSON.parse(input?.textContent ?? "")).toEqual({
      search: { keywords: ["Alice"] },
    });
    expect(dialog?.textContent).not.toContain('"items": []');
  });

  it("运行工具默认显示输入，同 id 完成后保留当前面板和换行状态", async () => {
    await render_dialog(tool_running('{"path":"SKILL.md"}'));
    const input_tab = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent === "agent_page.tool.input",
    );
    const wrap_button = document.body.querySelector<HTMLButtonElement>(
      "button[aria-label='agent_page.tool.wrap_disabled']",
    );
    expect(input_tab?.getAttribute("data-state")).toBe("active");
    expect(wrap_button?.getAttribute("aria-pressed")).toBe("false");
    expect(
      document.body.querySelector('[role="dialog"] .cm-content[aria-label="agent_page.tool.input"]')
        ?.textContent,
    ).toContain("SKILL.md");

    await act(async () => wrap_button?.click());
    expect(wrap_button?.getAttribute("aria-pressed")).toBe("true");
    expect(wrap_button?.getAttribute("aria-label")).toBe("agent_page.tool.wrap_enabled");
    expect(
      document.body.querySelector(".agent-tool-detail__viewer.app-editor--wrap-lines"),
    ).not.toBeNull();

    await render_dialog(tool_success('{"path":"SKILL.md"}', "完整正文。"));
    expect(input_tab?.getAttribute("data-state")).toBe("active");
    expect(wrap_button?.getAttribute("aria-pressed")).toBe("true");
    expect(
      document.body.querySelector('[role="dialog"] .cm-content[aria-label="agent_page.tool.input"]')
        ?.textContent,
    ).toContain("SKILL.md");
  });

  it("非 JSON 输出保持模型原文并使用纯文本查看器", async () => {
    await render_dialog(tool_success("{}", "第一行\n第二行 <tag>"));

    const output = document.body.querySelector('.cm-content[aria-label="agent_page.tool.output"]');
    expect(
      [...(output?.querySelectorAll(".cm-line") ?? [])].map((line) => line.textContent),
    ).toEqual(["第一行", "第二行 <tag>"]);
    expect(output?.querySelector("span")).toBeNull();
  });
});

function tool_running(input: string): AgentToolEntry {
  return {
    kind: "tool_call",
    id: "tool-1",
    toolName: "workspace_script",
    input,
    status: "running",
    output: null,
    createdAt: 1,
  };
}

function tool_success(input: string, output: string): AgentToolEntry {
  return {
    kind: "tool_call",
    id: "tool-1",
    toolName: "workspace_script",
    input,
    status: "success",
    output,
    createdAt: 1,
  };
}
