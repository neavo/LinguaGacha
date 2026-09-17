import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentToolEntry } from "@shared/agent";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import * as tool_output from "./agent-tool-output";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params === undefined ? key : `${key}:${Object.values(params).join(",")}`,
  }),
}));

vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
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
    vi.restoreAllMocks();
  });

  /** 当前对话框随同一 root 更新，观察输入与输出面板的实际挂载。 */
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
    await render_dialog(
      tool_success("web_search", '{"search":{"keywords":["Alice"]}}', '{"items":[]}'),
    );

    const dialog = document.body.querySelector('[role="dialog"]');
    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const input_tab = tabs.find((tab) => tab.textContent === "agent_page.tool.input");
    const output_tab = tabs.find((tab) => tab.textContent === "agent_page.tool.output");
    expect(output_tab?.hasAttribute("data-active")).toBe(true);
    const output = dialog?.querySelector<HTMLElement>(
      ".cm-content[aria-label='agent_page.tool.output']",
    );
    expect(JSON.parse(output?.textContent ?? "")).toEqual({ items: [] });
    expect(output?.querySelector(".cm-line span")).not.toBeNull();
    expect(dialog?.textContent).not.toContain("Alice");

    await act(async () => input_tab?.click());
    expect(input_tab?.hasAttribute("data-active")).toBe(true);
    const input = dialog?.querySelector<HTMLElement>(
      ".cm-content[aria-label='agent_page.tool.input']",
    );
    expect(JSON.parse(input?.textContent ?? "")).toEqual({
      search: { keywords: ["Alice"] },
    });
    expect(dialog?.textContent).not.toContain('"items"');
  });

  it("运行工具默认显示输入，同 id 完成后保留当前面板", async () => {
    await render_dialog(tool_running("read_skill", '{"path":"SKILL.md"}'));
    const input_tab = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent === "agent_page.tool.input",
    );
    expect(input_tab?.hasAttribute("data-active")).toBe(true);
    expect(
      document.body.querySelector('[role="dialog"] .cm-content[aria-label="agent_page.tool.input"]')
        ?.textContent,
    ).toContain("SKILL.md");
    await render_dialog(tool_success("read_skill", '{"path":"SKILL.md"}', "完整正文。"));
    expect(input_tab?.hasAttribute("data-active")).toBe(true);
    expect(
      document.body.querySelector('[role="dialog"] .cm-content[aria-label="agent_page.tool.input"]')
        ?.textContent,
    ).toContain("SKILL.md");
  });

  it("workspace_run 输入直接显示保持原文的 JavaScript 程序", async () => {
    const script = "const contract = ws.contract;\nconsole.log(contract.limits);";
    await render_dialog(tool_running("workspace_run", JSON.stringify({ script })));

    const input = document.body.querySelector<HTMLElement>(
      '.cm-content[aria-label="agent_page.tool.input"]',
    );
    expect(
      [...(input?.querySelectorAll(".cm-line") ?? [])].map((line) => line.textContent),
    ).toEqual(script.split("\n"));
    expect(input?.querySelector(".cm-line span")).not.toBeNull();
  });

  it("workspace_run 输入包含其他字段时完整显示 JSON", async () => {
    const input_value = { script: "console.log({});", timeout: 1 };
    await render_dialog(tool_running("workspace_run", JSON.stringify(input_value)));

    const input = document.body.querySelector<HTMLElement>(
      '.cm-content[aria-label="agent_page.tool.input"]',
    );
    const input_text = [...(input?.querySelectorAll(".cm-line") ?? [])]
      .map((line) => line.textContent)
      .join("\n");
    expect(JSON.parse(input_text)).toEqual(input_value);
  });

  it("非 JSON 输出保持模型原文并使用纯文本查看器", async () => {
    await render_dialog(tool_success("web_search", "{}", "第一行\n第二行 <tag>"));

    const output = document.body.querySelector('.cm-content[aria-label="agent_page.tool.output"]');
    expect(
      [...(output?.querySelectorAll(".cm-line") ?? [])].map((line) => line.textContent),
    ).toEqual(["第一行", "第二行 <tag>", ""]);
  });

  it("多个结果块在同一查看器内逐块换行并保留各自的 JSON 高亮", async () => {
    await render_dialog({
      ...tool_success("workspace_run", "{}", ""),
      status: "success",
      output: ["完成🌸\n", '{"first":1}', '{"second":2}'],
    });
    const output = document.body.querySelector('.cm-content[aria-label="agent_page.tool.output"]');
    expect([...output!.querySelectorAll(".cm-line")].map((line) => line.textContent)).toEqual([
      "完成🌸",
      "{",
      '  "first": 1',
      "}",
      "{",
      '  "second": 2',
      "}",
      "",
    ]);
    expect([...output!.querySelectorAll(".cm-line span")].map((span) => span.textContent)).toEqual(
      expect.arrayContaining(['"first"', '"second"']),
    );
    expect(document.body.querySelectorAll(".cm-editor")).toHaveLength(1);
  });

  it("隐藏结果延迟格式化，切换和刷新复用文档，实际 DOM 显示多行文本", async () => {
    const format = vi.spyOn(tool_output, "format_agent_tool_output");
    await render_dialog(tool_running("any_tool", "{}"));
    const entry = tool_success(
      "any_tool",
      "{}",
      JSON.stringify({ data: JSON.stringify({ text: " \r\n一\n\n\t二\n\t " }) }),
    );
    await render_dialog(entry);
    expect(format).not.toHaveBeenCalled();
    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const input_tab = tabs.find((tab) => tab.textContent === "agent_page.tool.input");
    const output_tab = tabs.find((tab) => tab.textContent === "agent_page.tool.output");
    await act(async () => output_tab?.click());
    expect(format).toHaveBeenCalledTimes(1);
    const output = document.body.querySelector('.cm-content[aria-label="agent_page.tool.output"]');
    expect([...output!.querySelectorAll(".cm-line")].map((line) => line.textContent)).toEqual(
      expect.arrayContaining(["      一", "      ", "      \t二"]),
    );
    expect(output?.querySelector(".cm-viewer-text")).not.toBeNull();
    expect(document.body.querySelectorAll(".cm-editor")).toHaveLength(1);
    await render_dialog({ ...entry });
    expect(document.body.querySelector('.cm-content[aria-label="agent_page.tool.output"]')).toBe(
      output,
    );
    await act(async () => input_tab?.click());
    await act(async () => output_tab?.click());
    expect(format).toHaveBeenCalledTimes(1);
    await render_dialog({ ...entry, status: "success", output: ['{"new": 2}'] });
    expect(format).toHaveBeenCalledTimes(2);
    expect(
      document.body.querySelector('.cm-content[aria-label="agent_page.tool.output"]')?.textContent,
    ).toContain('"new": 2');
  });
});

/** 构造尚未返回输出的工具条目。 */
function tool_running(tool_name: string, input: string): AgentToolEntry {
  return {
    kind: "tool_call",
    id: "tool-1",
    toolName: tool_name,
    input,
    status: "running",
    output: null,
    createdAt: 1,
  };
}

/** 构造含完整模型输出的已完成条目。 */
function tool_success(tool_name: string, input: string, output: string): AgentToolEntry {
  return {
    kind: "tool_call",
    id: "tool-1",
    toolName: tool_name,
    input,
    status: "success",
    output: [output],
    createdAt: 1,
  };
}
