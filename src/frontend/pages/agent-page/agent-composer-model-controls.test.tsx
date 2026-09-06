import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentComposerModelControls } from "./agent-composer-model-controls";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AgentComposerModelControls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: ModelSelectionController;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    controller = {
      snapshot: {
        model_selection: { agent: "a", translation: "a", agent_batch_translation: null },
        models: [
          {
            id: "a",
            name: "模型 A",
            type: "PRESET",
            agent_limits: { context_window: 128000, max_output_tokens: 32000 },
            thinking_level: "OFF",
            available_thinking_levels: [],
          },
        ],
      },
      loading: false,
      updating: false,
      select_model: vi.fn(async () => undefined),
      select_agent_batch_translation_model: vi.fn(async () => undefined),
      update_thinking_level: vi.fn(async () => undefined),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("从跟随菜单选择具体模型，同一主模型 ID 也显示固定选择", async () => {
    await render();
    expect(trigger().textContent).toContain("agent_page.batch_translation_model.follow");
    await act(async () => trigger().click());
    const follow = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]')!;
    expect(follow.getAttribute("aria-current")).toBe("true");
    await act(async () =>
      document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')!.click(),
    );
    const model = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent === "模型 A",
    )!;
    await act(async () => model.click());
    expect(controller.select_agent_batch_translation_model).toHaveBeenCalledWith("a");
    controller.snapshot.model_selection.agent_batch_translation = "a";
    await render();
    expect(trigger().textContent).toContain("模型 A");
    await act(async () => trigger().click());
    const follow_again = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ].find((item) => item.textContent === "agent_page.batch_translation_model.follow_option")!;
    expect(follow_again.getAttribute("aria-current")).toBeNull();
    await act(async () => follow_again.click());
    expect(controller.select_agent_batch_translation_model).toHaveBeenLastCalledWith(null);
  });

  it.each(["loading", "updating"] as const)("%s 时模型入口使用共同禁用状态", async (state) => {
    controller.loading = state === "loading";
    controller.updating = state === "updating";
    await render();
    expect(trigger().disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label^="app.model.selection.label"]')
        ?.disabled,
    ).toBe(true);
  });

  it("所选模型没有可用思考档位时保留可聚焦的禁用入口", async () => {
    await render();
    const thinking = container.querySelector<HTMLButtonElement>(
      ".agent-composer__thinking-trigger",
    );
    expect(thinking?.disabled).toBe(true);
    expect(thinking?.textContent).toContain("app.model.thinking_level.default");
    expect(thinking?.parentElement?.tabIndex).toBe(0);
  });

  it("切换模型选择后仍按当前会话容量显示上下文用量", async () => {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentComposerModelControls
            controller={controller}
            context_tokens={64_000}
            context_limits={{ context_window: 256_000, max_output_tokens: 32_000 }}
          />
        </TooltipProvider>,
      ),
    );
    expect(container.querySelector(".agent-composer__model-context")?.textContent).toBe("25.0%");
  });

  it("收起底部交互时关闭模型菜单，恢复后保持关闭", async () => {
    await render();
    await act(async () => trigger().click());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await render(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(trigger().disabled).toBe(true);
    await render();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(trigger().disabled).toBe(false);
  });

  /** 复用同一组件实例观察保存回包及公共禁用状态。 */
  async function render(locked = false): Promise<void> {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentComposerModelControls
            locked={locked}
            context_limits={null}
            controller={controller}
            context_tokens={0}
          />
        </TooltipProvider>,
      ),
    );
  }

  /** 按用户可见用途定位批量翻译模型入口。 */
  function trigger(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label^="agent_page.batch_translation_model.tooltip"]',
    )!;
  }
});
