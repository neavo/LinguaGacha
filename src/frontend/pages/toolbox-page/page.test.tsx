import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { navigate_to_route_mock } = vi.hoisted(() => {
  return {
    navigate_to_route_mock: vi.fn(),
  };
});

vi.mock("@frontend/app/navigation/navigation-context", () => {
  return {
    useAppNavigation: () => ({
      navigate_to_route: navigate_to_route_mock,
    }),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  const messages: Record<string, string> = {
    "toolbox_page.title": "百宝箱",
    "toolbox_page.entries.ts_conversion.title": "繁简转换",
    "toolbox_page.entries.ts_conversion.description":
      "对当前项目的译文或角色名称进行批量繁简转换，支持文本保护",
  };

  return {
    useI18n: () => ({
      t: (key: string) => messages[key] ?? key,
    }),
  };
});

import { ToolboxPage } from "./page";

describe("ToolboxPage", () => {
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
    navigate_to_route_mock.mockClear();
  });

  it("只展示繁简转换卡片并在点击后进入对应页面", async () => {
    await render_page();

    const cards = Array.from(container?.querySelectorAll(".toolbox-page__card") ?? []);
    const card = cards[0] as HTMLElement | undefined;
    if (card === undefined) {
      throw new Error("缺少百宝箱卡片。");
    }

    expect(cards).toHaveLength(1);
    expect(container?.textContent).toContain("繁简转换");
    expect(container?.textContent).toContain("对当前项目的译文或角色名称进行批量繁简转换");

    await act(async () => {
      card.click();
    });

    expect(navigate_to_route_mock).toHaveBeenCalledWith("ts-conversion");
  });

  async function render_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ToolboxPage is_sidebar_collapsed={false} />);
    });
  }
});
