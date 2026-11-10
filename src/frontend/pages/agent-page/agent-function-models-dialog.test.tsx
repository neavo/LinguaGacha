import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentFunctionModelsDialog } from "./agent-function-models-dialog";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("AgentFunctionModelsDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: ModelSelectionController;
  const on_agent_model_select = vi.fn();
  const on_close = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    on_agent_model_select.mockReset().mockReturnValue(false);
    on_close.mockReset();
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

  it("翻译选择一次提交模型与等级", async () => {
    await render();
    await act(async () =>
      document.querySelectorAll<HTMLButtonElement>(".agent-function-models__select")[1]!.click(),
    );
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
    expect(
      document
        .querySelectorAll<HTMLButtonElement>(".agent-function-models__select")[1]!
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("弹窗中的音视频跟随即时提交，锁定后禁用选择并关闭菜单", async () => {
    controller.snapshot.model_selection.agent_media = "a";
    await render();
    const menus = document.querySelectorAll<HTMLButtonElement>(".agent-function-models__select");
    await act(async () => menus[2]!.click());
    await act(async () =>
      document.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]')!.click(),
    );
    expect(controller.select_model).toHaveBeenCalledWith({ target: "agent_media", model_id: null });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => menus[0]!.click());
    await render({ locked: true });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect([...menus].every((button) => button.disabled)).toBe(true);
  });

  it("主控选择走会话回调，需确认时先关闭功能窗口", async () => {
    on_agent_model_select.mockReturnValue(true);
    await render();
    await act(async () =>
      document.querySelector<HTMLButtonElement>(".agent-function-models__select")!.click(),
    );
    await act(async () =>
      document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')!.click(),
    );
    const model = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ].find((item) => item.textContent === "模型 A")!;
    await act(async () => model.click());
    expect(on_agent_model_select).toHaveBeenCalledWith({ model_id: "a" });
    expect(on_close).toHaveBeenCalledOnce();
    expect(controller.select_model).not.toHaveBeenCalled();
  });

  /** 保留弹窗实例，验证控制器回包和运行锁变化。 */
  async function render(
    overrides: Partial<React.ComponentProps<typeof AgentFunctionModelsDialog>> = {},
  ): Promise<void> {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentFunctionModelsDialog
            open
            controller={controller}
            locked={false}
            on_close={on_close}
            on_agent_model_select={on_agent_model_select}
            {...overrides}
          />
        </TooltipProvider>,
      ),
    );
  }
});
