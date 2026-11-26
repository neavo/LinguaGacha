import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_REPOSITORY_URL } from "@frontend/app/desktop/desktop-api";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";
import { AgentStarPrompt } from "./agent-star-prompt";

describe("AgentStarPrompt", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    window.localStorage.clear();
  });

  function render_prompt(): void {
    act(() => {
      root.render(
        <LocaleProvider locale="zh-CN">
          <AgentStarPrompt />
        </LocaleProvider>,
      );
    });
  }

  it("取消后保留原胶囊，可以再次打开弹窗", () => {
    render_prompt();
    const prompt = container.querySelector("button")!;
    act(() => prompt.click());
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]')!.click(),
    );
    expect(container.querySelector("button")).toBe(prompt);
    expect(document.querySelector('[data-slot="alert-dialog-content"][data-open]')).toBeNull();
    act(() => prompt.click());
    expect(document.querySelector('[data-slot="alert-dialog-content"][data-open]')).not.toBeNull();
  });

  it.each([
    ["不再提醒", "secondary", []],
    ["跳转到 GitHub", "primary", [[GITHUB_REPOSITORY_URL]]],
  ] as const)("「%s」立即隐藏胶囊，重新挂载仍不再提醒", async (_label, action, links) => {
    const open_external_url = vi.fn(async () => undefined);
    vi.stubGlobal(
      "desktopApp",
      create_desktop_bridge_api_mock({ methods: { openExternalUrl: open_external_url } }),
    );
    render_prompt();
    act(() => container.querySelector("button")!.click());
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(`[data-slot="alert-dialog-${action}-action"]`)!
        .click(),
    );
    expect(open_external_url.mock.calls).toEqual(links);
    expect(container.querySelector("button")).toBeNull();
    act(() => root.render(null));
    render_prompt();
    expect(container.querySelector("button")).toBeNull();
  });
});
