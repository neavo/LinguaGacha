import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ModelSelectionController } from "./use-model-selection";
import { ModelSelectionMenu } from "./model-selection-menu";

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
        model_selection: { translation: "openai", analysis: "", agent: "" },
        models: [
          { id: "preset", type: "PRESET", name: "" },
          { id: "openai", type: "CUSTOM_OPENAI", name: "OpenAI Main" },
        ],
      },
      loading: false,
      updating: false,
      select_model,
    };

    const html = renderToStaticMarkup(
      <ModelSelectionMenu controller={controller} usage="translation" />,
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    const labels = [...document.querySelectorAll("button")].map((button) => button.textContent);

    expect(labels).toEqual([
      "OpenAI Main",
      "app.model.type.preset",
      "app.model.type.google",
      "app.model.type.openaiapp.model.selection.current_category",
      "app.model.type.anthropic",
    ]);
    expect(document.querySelectorAll("button:disabled")).toHaveLength(2);
    expect(document.querySelector('button[aria-current="true"]')?.textContent).toContain(
      "app.model.type.openai",
    );
    expect(document.querySelector('[role="radiogroup"][data-value="openai"]')).not.toBeNull();
    expect(document.querySelector('[role="radio"][data-value="preset"]')?.textContent).toBe(
      "preset",
    );
    menu_state.on_value_change?.("preset");
    expect(select_model).toHaveBeenCalledWith("translation", "preset");
  });
});
