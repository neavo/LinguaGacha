import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_REPOSITORY_URL } from "@frontend/app/desktop/desktop-api";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AgentStarPrompt } from "./agent-star-prompt";

const open_external_url = vi.hoisted(() => vi.fn(async () => undefined));
const page_ui = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  open_external_url,
}));

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ active_project: { pageUi: page_ui } }),
}));

describe("AgentStarPrompt", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    page_ui.clear();
    window.localStorage.clear();
    open_external_url.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
  });

  /** 像对话页面一样按轮次挂载，传入 `null` 模拟离开工程。 */
  function render_prompt(round_id: string | null): void {
    act(() => {
      root.render(
        <LocaleProvider locale="zh-CN">
          {round_id === null ? null : <AgentStarPrompt key={round_id} round_id={round_id} />}
        </LocaleProvider>,
      );
    });
  }

  it("取消后切回工程仍收起同一轮，下次完成导出仍可提醒", () => {
    render_prompt("round-1");
    act(() => container.querySelector("button")!.click());
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]')!.click(),
    );
    expect(container.querySelector("button")).toBeNull();
    render_prompt(null);
    render_prompt("round-1");
    expect(container.querySelector("button")).toBeNull();
    render_prompt("round-2");
    expect(container.querySelector("button")).not.toBeNull();
  });

  it.each([
    ["不再提醒", "secondary", []],
    ["跳转到 GitHub", "primary", [[GITHUB_REPOSITORY_URL]]],
  ] as const)("%s后，其他工程的导出也不会再提醒", async (_label, action, links) => {
    render_prompt("round-1");
    act(() => container.querySelector("button")!.click());
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(`[data-slot="alert-dialog-${action}-action"]`)!
        .click(),
    );
    expect(open_external_url.mock.calls).toEqual(links);
    expect(container.querySelector("button")).toBeNull();
    page_ui.clear();
    render_prompt("round-2");
    expect(container.querySelector("button")).toBeNull();
  });
});
