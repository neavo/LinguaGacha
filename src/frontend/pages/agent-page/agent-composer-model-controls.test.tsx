import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentComposerModelControls } from "./agent-composer-model-controls";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AgentComposerModelControls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: ModelSelectionController;
  const on_agent_model_select = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    on_agent_model_select.mockClear();
    controller = {
      snapshot: {
        model_selection: { agent: "a", translation: "a", agent_batch_translation: null },
        models: [
          {
            id: "a",
            name: "模型 A",
            type: "PRESET",
            agent_limits: { context_window: 128_000, max_output_tokens: 32_000 },
            thinking_level: "OFF",
            available_thinking_levels: ["OFF", "HIGH"],
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
    container.remove();
  });

  it("批量入口选择等级时一次提交模型与等级", async () => {
    await render();
    const batch = batch_trigger();
    await act(async () => batch.click());
    expect(
      document.querySelector('[data-slot="dropdown-menu-item"]')?.getAttribute("aria-current"),
    ).toBe("true");
    await act(async () =>
      document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')!.click(),
    );
    const model = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ].find((item) => item.textContent === "模型 A")!;
    await act(async () =>
      model.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
    );
    const level = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent === "app.model.thinking_level.high",
    )!;
    await act(async () => level.click());
    expect(controller.select_model).toHaveBeenCalledExactlyOnceWith({
      target: "agent_batch_translation",
      model_id: "a",
      thinking_level: "HIGH",
    });
    expect(batch.getAttribute("aria-expanded")).toBe("false");
  });

  it("三个入口显示已选模型等级，批量跟随保留原文案", async () => {
    await render();
    const main = main_trigger();
    expect(main.textContent).toContain("模型 A·app.model.thinking_level.off");
    expect(main.getAttribute("aria-label")).toContain("模型 A · app.model.thinking_level.off");
    expect(batch_trigger().textContent).toContain("agent_page.batch_translation_model.follow");
    expect(batch_trigger().querySelector(".agent-composer__model-thinking")).toBeNull();

    controller.snapshot.models[0]!.thinking_level = "HIGH";
    await render();
    expect(batch_trigger().querySelector(".agent-composer__model-thinking")).toBeNull();

    controller.snapshot.model_selection.agent_batch_translation = "a";
    await render();
    expect(batch_trigger().textContent).toContain("模型 A·app.model.thinking_level.high");

    controller.snapshot.models[0]!.available_thinking_levels = [];
    await render();
    expect(main_trigger().textContent).toContain("app.model.thinking_level.default");
    expect(batch_trigger().textContent).toContain("app.model.thinking_level.default");
  });

  it("四行提示显示累计统计与当前会话容量", async () => {
    await render({
      context_tokens: 100_000,
      context_limits: { context_window: 128_000, max_output_tokens: 16_000 },
    });
    const main = main_trigger();
    await act(async () => main.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain("agent_page.usage.input12.34K");
    expect(tooltip?.textContent).toContain("agent_page.usage.output500");
    expect(tooltip?.textContent).toContain("agent_page.usage.cache_hit_rate72.93%");
    expect(tooltip?.textContent).toContain("agent_page.context_usage_warning100K/128K");
  });

  it("无用量和无模型容量时显示零值", async () => {
    await render({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    const main = main_trigger();
    expect(main.textContent).toContain("0.0%");
    await act(async () => main.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain("agent_page.usage.cache_hit_rate0.00%");
    expect(tooltip?.textContent).toContain("agent_page.usage.context_window0K/128K");

    controller.snapshot.models = [];
    await render({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "agent_page.usage.context_window0K/0K",
    );
  });

  it("锁定时关闭菜单", async () => {
    await render();
    await act(async () => main_trigger().click());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await render({ locked: true });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  /** 保留组件实例，观察会话和配置变化后的显示与菜单状态。 */
  async function render(
    overrides: Partial<React.ComponentProps<typeof AgentComposerModelControls>> = {},
  ): Promise<void> {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentComposerModelControls
            controller={controller}
            context_tokens={null}
            context_limits={null}
            usage={{ input: 3_340, output: 500, cacheRead: 9_000, cacheWrite: 0 }}
            on_agent_model_select={on_agent_model_select}
            {...overrides}
          />
        </TooltipProvider>,
      ),
    );
  }

  /** 按入口用途定位主模型按钮。 */
  function main_trigger(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label^="app.model.selection.label"]',
    )!;
  }

  /** 按入口用途定位批量翻译按钮。 */
  function batch_trigger(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label^="agent_page.batch_translation_model.tooltip"]',
    )!;
  }
});
