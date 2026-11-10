import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentComposerModelControls } from "./agent-composer-model-controls";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
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
        model_selection: {
          agent: "a",
          translation: "a",
          agent_batch_translation: null,
          agent_media: null,
        },
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

  it("功能提示只在主控行更新模型名称，跟随项保留简短说明", async () => {
    controller.snapshot.models.push({ ...controller.snapshot.models[0]!, id: "c", name: "媒体 C" });
    controller.snapshot.model_selection.agent_media = "c";
    await render();
    const trigger = functions_trigger();
    await act(async () => trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    const tooltip = document.querySelector(".agent-function-models__tooltip")!;
    expect(tooltip.children[3]!.textContent).toBe("agent_page.function_models.follow");
    expect(tooltip.children[1]!.textContent).toBe("模型 A");
    expect(tooltip.textContent).toContain("媒体 C");
    controller.snapshot.models[0]!.name = "主控新名称";
    await render();
    expect(tooltip.children[3]!.textContent).toBe("agent_page.function_models.follow");
    expect(tooltip.children[1]!.textContent).toBe("主控新名称");
    expect(tooltip.textContent).toContain("媒体 C");
    await act(async () => trigger.click());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
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

  /** 按可见文案定位子模型入口。 */
  function functions_trigger(): HTMLButtonElement {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "agent_page.function_models.title",
    )!;
  }
});
