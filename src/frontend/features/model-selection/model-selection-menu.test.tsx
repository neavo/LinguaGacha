import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import type { ModelSelectionController } from "./use-model-selection";
import { ModelSelectionMenu } from "./model-selection-menu";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("ModelSelectionMenu", () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: ModelSelectionController;

  beforeEach(() => {
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    controller = {
      snapshot: {
        model_selection: { translation: "a", agent: "", agent_batch_translation: null },
        models: [
          {
            id: "a",
            name: "模型 A",
            type: "PRESET",
            agent_limits: { context_window: 128_000, max_output_tokens: 32_000 },
            thinking_level: "HIGH",
            available_thinking_levels: ["OFF", "HIGH"],
          },
          {
            id: "b",
            name: "模型 B",
            type: "PRESET",
            agent_limits: { context_window: 128_000, max_output_tokens: 32_000 },
            thinking_level: "OFF",
            available_thinking_levels: [],
          },
        ],
      },
      loading: false,
      updating: false,
      select_model: vi.fn(async () => undefined),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it.each(["click", "Enter", " "])("等级菜单展开后仍可直接选模并关闭根菜单：%s", async (action) => {
    await open_models();
    const model = document.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-sub-trigger"][title="模型 A"]',
    )!;
    await act(async () =>
      model.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
    );
    expect(document.querySelector('[role="menuitemradio"]')).not.toBeNull();
    expect(controller.select_model).not.toHaveBeenCalled();
    await act(async () => {
      model.focus();
      if (action === "click") model.click();
      else {
        model.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: action }));
        model.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: action }));
      }
    });
    expect(controller.select_model).toHaveBeenCalledExactlyOnceWith({
      target: "translation",
      model_id: "a",
    });
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("等级叶子一次提交模型与等级并关闭根菜单", async () => {
    await open_models();
    const model = document.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-sub-trigger"][title="模型 A"]',
    )!;
    await act(async () =>
      model.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
    );
    const level = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.getAttribute("aria-checked") === "true",
    )!;
    await act(async () => level.click());
    expect(controller.select_model).toHaveBeenCalledExactlyOnceWith({
      target: "translation",
      model_id: "a",
      thinking_level: "HIGH",
    });
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("失效选择仍能通过无等级模型恢复", async () => {
    controller.snapshot.model_selection.translation = "missing";
    await open_models();
    const model = document.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-item"][title="模型 B"]',
    )!;
    expect(model.getAttribute("aria-haspopup")).toBeNull();
    await act(async () => model.click());
    expect(controller.select_model).toHaveBeenCalledExactlyOnceWith({
      target: "translation",
      model_id: "b",
    });
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  /** 从工作台的根菜单进入模型分类，使用真实 Base UI 观察选择与关闭行为。 */
  async function open_models(): Promise<void> {
    await act(async () =>
      root.render(
        <AppDropdownMenu>
          <AppDropdownMenuTrigger>任务</AppDropdownMenuTrigger>
          <AppDropdownMenuContent>
            <ModelSelectionMenu controller={controller} usage="translation" />
          </AppDropdownMenuContent>
        </AppDropdownMenu>,
      ),
    );
    await act(async () => host.querySelector("button")!.click());
    await act(async () =>
      document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')!.click(),
    );
    const category = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ].find((item) => !item.hasAttribute("title") && !item.hasAttribute("data-disabled"))!;
    await act(async () => category.click());
  }
});
