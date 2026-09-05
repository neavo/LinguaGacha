import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ModelSelectionController } from "./use-model-selection";
import { ModelSelectionMenu, ModelThinkingLevelOptions } from "./model-selection-menu";

const menu_state = vi.hoisted(() => ({
  on_value_change: null as ((value: string) => void) | null,
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/widgets/app-dropdown-menu", () => ({
  AppDropdownMenuSub: (props: { children: ReactNode }) => <section>{props.children}</section>,
  AppDropdownMenuSubTrigger: (props: {
    children: ReactNode;
    disabled?: boolean;
    "aria-current"?: "true";
  }) => (
    <button disabled={props.disabled} aria-current={props["aria-current"]}>
      {props.children}
    </button>
  ),
  AppDropdownMenuSubContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuRadioGroup: (props: {
    children: ReactNode;
    value?: string;
    onValueChange: (value: string) => void;
  }) => {
    menu_state.on_value_change = props.onValueChange;
    return (
      <div role="radiogroup" data-value={props.value}>
        {props.children}
      </div>
    );
  },
  AppDropdownMenuRadioItem: (props: { children: ReactNode; value: string }) => (
    <div role="radio" data-value={props.value}>
      {props.children}
    </div>
  ),
}));

describe("ModelSelectionMenu", () => {
  it("展示当前分类与模型，并把选择提交给对应任务用途", () => {
    const select_model = vi.fn(async () => undefined);
    const controller: ModelSelectionController = {
      snapshot: {
        model_selection: { translation: "openai", agent: "" },
        models: [
          {
            id: "preset",
            type: "PRESET",
            name: "",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
            thinking_level: "OFF",
            available_thinking_levels: ["OFF", "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"],
          },
          {
            id: "openai",
            type: "CUSTOM_OPENAI",
            name: "OpenAI Main",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
            thinking_level: "MEDIUM",
            available_thinking_levels: ["OFF", "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"],
          },
        ],
      },
      loading: false,
      updating: false,
      select_model,
      update_thinking_level: vi.fn(async () => undefined),
    };

    const html = renderToStaticMarkup(
      <ModelSelectionMenu controller={controller} usage="translation" />,
    );
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector('button[aria-current="true"]')).not.toBeNull();
    expect(document.querySelector('[role="radiogroup"][data-value="openai"]')).not.toBeNull();
    expect(document.querySelector('[role="radio"][data-value="preset"]')).not.toBeNull();
    menu_state.on_value_change?.("preset");
    expect(select_model).toHaveBeenCalledWith("translation", "preset");
  });

  it("当前选择失效时仍可打开菜单恢复到可用模型", () => {
    const controller: ModelSelectionController = {
      snapshot: {
        model_selection: { translation: "missing", agent: "" },
        models: [
          {
            id: "openai",
            type: "CUSTOM_OPENAI",
            name: "OpenAI Main",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
            thinking_level: "OFF",
            available_thinking_levels: ["OFF", "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"],
          },
        ],
      },
      loading: false,
      updating: false,
      select_model: vi.fn(async () => undefined),
      update_thinking_level: vi.fn(async () => undefined),
    };

    const html = renderToStaticMarkup(
      <ModelSelectionMenu controller={controller} usage="translation" />,
    );
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector("button")?.disabled).toBe(false);
    expect(document.querySelector('[role="radio"][data-value="openai"]')).not.toBeNull();
  });

  it("展示当前思考档位并提交合法选择", () => {
    const update_thinking_level = vi.fn(async () => undefined);
    const controller: ModelSelectionController = {
      snapshot: {
        model_selection: { translation: "", agent: "openai" },
        models: [
          {
            id: "openai",
            type: "CUSTOM_OPENAI",
            name: "OpenAI Main",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
            thinking_level: "MEDIUM",
            available_thinking_levels: ["LOW", "MEDIUM", "MAX"],
          },
        ],
      },
      loading: false,
      updating: false,
      select_model: vi.fn(async () => undefined),
      update_thinking_level,
    };

    const html = renderToStaticMarkup(
      <ModelThinkingLevelOptions controller={controller} usage="agent" />,
    );
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector('[role="radiogroup"]')?.getAttribute("data-value")).toBe(
      "MEDIUM",
    );
    expect(document.querySelector('[role="radio"][data-value="MAX"]')).not.toBeNull();
    expect(document.querySelector('[role="radio"][data-value="OFF"]')).toBeNull();
    menu_state.on_value_change?.("MAX");
    expect(update_thinking_level).toHaveBeenCalledWith("agent", "MAX");
  });

  it("当前模型不可配置思考档位时不渲染选项", () => {
    const controller: ModelSelectionController = {
      snapshot: {
        model_selection: { translation: "", agent: "sakura" },
        models: [
          {
            id: "sakura",
            type: "PRESET",
            name: "Sakura",
            agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
            thinking_level: "OFF",
            available_thinking_levels: [],
          },
        ],
      },
      loading: false,
      updating: false,
      select_model: vi.fn(async () => undefined),
      update_thinking_level: vi.fn(async () => undefined),
    };

    expect(
      renderToStaticMarkup(<ModelThinkingLevelOptions controller={controller} usage="agent" />),
    ).toBe("");
  });
});
