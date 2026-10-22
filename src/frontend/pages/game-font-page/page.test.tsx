import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { GameFontPage } from "@frontend/pages/game-font-page/page";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_toast: vi.fn(),
  push_error_toast: vi.fn(),
  run_modal_progress_toast: (args: { task: () => Promise<unknown> }) => args.task(),
}));

vi.mock("@frontend/app/desktop/desktop-api", async (import_original) => ({
  ...(await import_original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: vi.fn(),
}));

const FONT_PATH = "E:/fonts/custom.ttf";
const GAME_PATH = "E:/games/demo";

/** 按可见文案查找按钮，菜单项与对话框按钮位于 Portal 中，因此在整个文档中查找。 */
function get_button(text: string): HTMLElement {
  const button = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].findLast(
    (element) => element.textContent?.includes(text) ?? false,
  );
  if (button === undefined) throw new Error(`未找到按钮：${text}`);
  return button;
}

describe("GameFontPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: {
          pickGameFontFilePath: vi.fn(async () => ({ canceled: false, paths: [FONT_PATH] })),
          pickGameDirectoryPath: vi.fn(async () => ({ canceled: false, paths: [GAME_PATH] })),
        },
      }),
    });
    vi.mocked(api_fetch).mockResolvedValue({});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <LocaleProvider locale="zh-CN">
          <GameFontPage is_sidebar_collapsed={false} />
        </LocaleProvider>,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.mocked(api_fetch).mockReset();
    vi.useRealTimers();
  });

  /** 从游戏菜单选择目录，再点击字体框选择字体。 */
  async function select_game_and_font(): Promise<void> {
    await act(async () => get_button("点击或拖拽游戏程序或目录").click());
    await act(async () => get_button("选择游戏目录").click());
    await act(async () => get_button("点击或拖拽字体文件").click());
  }

  it("菜单选择游戏目录并选择字体后启用动作，确认目标与提交一致", async () => {
    expect(get_button("开始修改")).toHaveProperty("disabled", true);
    await select_game_and_font();

    const paths = { font_path: FONT_PATH, game_path: GAME_PATH };
    expect(api_fetch).toHaveBeenCalledWith("/api/toolbox/game-font/inspect", paths);
    expect(container.textContent).toContain(GAME_PATH);
    expect(get_button("开始修改")).toHaveProperty("disabled", false);

    vi.useFakeTimers();
    await act(async () => get_button("开始修改").click());
    const primary = document.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-primary-action"]',
    )!;
    expect(primary.disabled).toBe(true); // 备份提示倒计时结束前不能开始。
    const seconds = Number.parseInt(primary.textContent!, 10);
    act(() => vi.advanceTimersByTime(seconds * 1_000));
    const details = [...document.querySelectorAll('[data-slot="alert-dialog-details"] dd')];
    expect(details.map((element) => element.textContent)).toEqual([GAME_PATH, FONT_PATH]);
    await act(async () => primary.click());
    expect(api_fetch).toHaveBeenLastCalledWith("/api/toolbox/game-font/apply", paths);
  });
});
