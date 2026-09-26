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
            available_thinking_levels: ["DEFAULT", "OFF", "HIGH"],
          },
          {
            id: "b",
            name: "模型 B",
            type: "PRESET",
            agent_limits: { context_window: 128_000, max_output_tokens: 32_000 },
            thinking_level: "DEFAULT",
            available_thinking_levels: ["DEFAULT"],
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
    vi.useRealTimers();
  });

  it("失效选择下可悬停查看模型名称并点击恢复选择", async () => {
    controller.snapshot.model_selection.translation = "missing";
    await open_models();
    vi.useFakeTimers();
    const model = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ].find((item) => item.textContent === "模型 B")!;
    const name = model.querySelector<HTMLElement>("span")!;
    expect(model.hasAttribute("title")).toBe(false);
    await act(async () => {
      name.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      name.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')?.textContent).toBe("模型 B");
    await act(async () => name.click());
    expect(controller.select_model).toHaveBeenCalledExactlyOnceWith({
      target: "translation",
      model_id: "b",
    });
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["click", "Enter", " "])("等级菜单展开后仍可直接选模并关闭根菜单：%s", async (action) => {
    await open_models();
    const model = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ].find((item) => item.textContent === "模型 A")!;
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

  it.each(["HIGH", "DEFAULT"] as const)(
    "等级 %s 一次提交模型与等级并关闭根菜单",
    async (selected_level) => {
      await open_models();
      const model = [
        ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
      ].find((item) => item.textContent === "模型 A")!;
      await act(async () =>
        model.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
      );
      const level = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent === `app.model.thinking_level.${selected_level.toLowerCase()}`,
      )!;
      await act(async () => level.click());
      expect(controller.select_model).toHaveBeenCalledExactlyOnceWith({
        target: "translation",
        model_id: "a",
        thinking_level: selected_level,
      });
      expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    },
  );

  it.each(["模型 A", "模型 B"])(
    "%s 的保持默认位于末尾并提供说明，单项时没有分隔线",
    async (name) => {
      await open_models();
      const model = [
        ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
      ].find((item) => item.textContent === name)!;
      await act(async () =>
        model.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
      );
      const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
      const last = items.at(-1)!;
      expect(last.textContent).toBe("app.model.thinking_level.default");
      expect(last.previousElementSibling?.getAttribute("role") === "separator").toBe(
        name === "模型 A",
      );
      vi.useFakeTimers();
      await act(async () => {
        last.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        last.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        vi.runAllTimers();
      });
      expect(document.querySelector('[role="tooltip"][data-open]')?.textContent).toBe(
        "app.model.thinking_level.default_description",
      );
    },
  );

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
    ].find((item) => item.textContent === "app.model.type.preset")!;
    await act(async () => category.click());
  }
});
