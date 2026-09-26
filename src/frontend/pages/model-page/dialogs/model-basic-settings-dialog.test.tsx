import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelBasicSettingsDialog } from "./model-basic-settings-dialog";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ locale: "zh-CN", t: (key: string) => key }),
}));

describe("ModelBasicSettingsDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  it("打开的模型 ID 输入器在本地提交期间保持可选择且拒绝 Enter 提交", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => {});
    const render_dialog = async (readonly: boolean): Promise<void> => {
      await act(async () => {
        root?.render(
          <ModelBasicSettingsDialog
            test_disabled={true}
            open
            model={create_model_snapshot()}
            readonly={readonly}
            onPatch={on_patch}
            onRequestOpenSelector={() => {}}
            onRequestTestModel={() => {}}
            onClose={() => {}}
          />,
        );
      });
    };

    await render_dialog(false);
    const test_button = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("model_page.action.test"),
    );
    expect(test_button?.disabled).toBe(true);
    expect(document.querySelectorAll("input[readonly], textarea[readonly]").length).toBe(0);
    const input_button = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "model_page.action.input",
    );
    if (!(input_button instanceof HTMLButtonElement)) {
      throw new Error("模型 ID 输入按钮未挂载。");
    }
    await act(async () => input_button.click());
    const draft_input = document.querySelector<HTMLInputElement>(
      'input[placeholder="model_page.fields.model_id.placeholder"]',
    );
    if (draft_input === null) throw new Error("模型 ID 草稿输入框未挂载。");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        draft_input,
        "unsaved-model-id",
      );
      draft_input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render_dialog(true);

    const readonly_fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input[readonly], textarea[readonly]",
    );
    expect(readonly_fields.length).toBeGreaterThan(0);
    for (const field of readonly_fields) expect(field.disabled).toBe(false);

    const model_id_input = document.querySelector(
      'input[placeholder="model_page.fields.model_id.placeholder"]',
    );
    if (!(model_id_input instanceof HTMLInputElement)) {
      throw new Error("模型 ID 输入框未挂载。");
    }
    expect(model_id_input.value).toBe("unsaved-model-id");
    await act(async () => {
      model_id_input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(on_patch).not.toHaveBeenCalled();
  });

  it("Responses 模型只显示并提交后端确认可用的思考档位", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => {});
    await act(async () => {
      root?.render(
        <ModelBasicSettingsDialog
          test_disabled={true}
          open
          model={create_model_snapshot({
            api_format: "OpenAIResponses",
            thinking: { level: "LOW" },
            available_thinking_levels: ["DEFAULT", "LOW", "HIGH"],
          })}
          readonly={false}
          onPatch={on_patch}
          onRequestOpenSelector={() => {}}
          onRequestTestModel={() => {}}
          onClose={() => {}}
        />,
      );
    });

    const trigger = document.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]')!;
    await act(async () => trigger.click());
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((item) => item.textContent)).toEqual(
      ["low", "high", "default"].map((level) => `app.model.thinking_level.${level}`),
    );
    expect(options.at(-1)?.previousElementSibling?.getAttribute("data-slot")).toBe(
      "select-separator",
    );
    await act(async () => options[1]!.click());

    expect(on_patch).toHaveBeenCalledWith({ thinking: { level: "HIGH" } });
  });

  it("仅有保持默认时仍提供可用的选择器", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ModelBasicSettingsDialog
          test_disabled={true}
          open
          model={create_model_snapshot({
            thinking: { level: "DEFAULT" },
            available_thinking_levels: ["DEFAULT"],
          })}
          readonly={false}
          onPatch={async () => {}}
          onRequestOpenSelector={() => {}}
          onRequestTestModel={() => {}}
          onClose={() => {}}
        />,
      );
    });

    const trigger = document.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]')!;
    expect(trigger.disabled).toBe(false);
    expect(trigger.textContent).toContain("app.model.thinking_level.default");
    await act(async () => trigger.click());
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options).toHaveLength(1);
    expect(document.querySelector('[data-slot="select-separator"]')).toBeNull();
    vi.useFakeTimers();
    await act(async () => {
      options[0]!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      options[0]!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"][data-open]')?.textContent).toBe(
      "app.model.thinking_level.default_description",
    );
  });
});
