import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelBasicSettingsDialog } from "./model-basic-settings-dialog";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ locale: "zh-CN", t: (key: string) => key }),
}));

vi.mock("@frontend/shadcn/select", () => ({
  Select: (props: {
    children: ReactNode;
    value: string;
    disabled?: boolean;
    onValueChange: (value: string) => void;
  }) => (
    <select
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onValueChange(event.currentTarget.value)}
    >
      {props.children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: (props: { children: ReactNode }) => <>{props.children}</>,
  SelectGroup: (props: { children: ReactNode }) => <>{props.children}</>,
  SelectItem: (props: { children: ReactNode; value: string }) => (
    <option value={props.value}>{props.children}</option>
  ),
}));

describe("ModelBasicSettingsDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("打开的模型 ID 输入器在项目锁定后保持可选择且拒绝 Enter 提交", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => {});
    const render_dialog = async (readonly: boolean): Promise<void> => {
      await act(async () => {
        root?.render(
          <ModelBasicSettingsDialog
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
    const input_button = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "model_page.action.input",
    );
    if (!(input_button instanceof HTMLButtonElement)) {
      throw new Error("模型 ID 输入按钮未挂载。");
    }
    await act(async () => input_button.click());
    await render_dialog(true);

    const readonly_fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input[readonly], textarea[readonly]",
    );
    expect(readonly_fields).toHaveLength(4);
    for (const field of readonly_fields) expect(field.disabled).toBe(false);

    const model_id_input = document.querySelector(
      'input[placeholder="model_page.fields.model_id.placeholder"]',
    );
    if (!(model_id_input instanceof HTMLInputElement)) {
      throw new Error("模型 ID 输入框未挂载。");
    }
    await act(async () => {
      model_id_input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(on_patch).not.toHaveBeenCalled();
  });

  it("Responses 模型显示连接字段并提交特高思考档位", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => {});
    await act(async () => {
      root?.render(
        <ModelBasicSettingsDialog
          open
          model={create_model_snapshot({ api_format: "OpenAIResponses" })}
          readonly={false}
          onPatch={on_patch}
          onRequestOpenSelector={() => {}}
          onRequestTestModel={() => {}}
          onClose={() => {}}
        />,
      );
    });

    expect(
      document.querySelector('input[placeholder="model_page.fields.api_url.placeholder"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("model_page.fields.thinking.title");

    const thinking_select = document.querySelector("select");
    if (!(thinking_select instanceof HTMLSelectElement)) {
      throw new Error("思考档位选择器未挂载。");
    }
    expect(thinking_select.querySelector('option[value="XHIGH"]')?.textContent).toBe(
      "app.model.thinking_level.xhigh",
    );
    await act(async () => {
      thinking_select.value = "XHIGH";
      thinking_select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(on_patch).toHaveBeenCalledWith({ thinking: { level: "XHIGH" } });
  });
});
