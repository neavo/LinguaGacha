import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelAdvancedSettingsDialog } from "./model-advanced-settings-dialog";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string) => key,
  }),
}));

/** 通过原生 value setter 触发 React 受控 textarea 的 input 事件。 */
function change_textarea_value(textarea: HTMLTextAreaElement, value: string): void {
  const value_descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  value_descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 通过原生 value setter 触发 React 受控 input 的 input 事件。 */
function change_input_value(input: HTMLInputElement, value: string): void {
  const value_descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  value_descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ModelAdvancedSettingsDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("自定义 JSON 关闭时只读且不提交，启用后在失焦时提交", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => {});
    const base_model = create_model_snapshot();
    const render_dialog = async (custom_enabled: boolean): Promise<void> => {
      await act(async () => {
        root?.render(
          <ModelAdvancedSettingsDialog
            open
            model={create_model_snapshot({
              request: {
                ...base_model.request,
                extra_headers_custom_enable: custom_enabled,
                extra_body_custom_enable: custom_enabled,
              },
            })}
            readonly={false}
            onPatch={on_patch}
            onAgentLimitsError={() => {}}
            onJsonFormatError={() => {}}
            onClose={() => {}}
          />,
        );
      });
    };

    await render_dialog(false);
    const readonly_json_fields = document.querySelectorAll("textarea[readonly]");
    expect(readonly_json_fields).toHaveLength(2);
    for (const field of readonly_json_fields) {
      expect(field).toHaveProperty("disabled", false);
      field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }
    expect(on_patch).not.toHaveBeenCalled();

    await render_dialog(true);
    const headers = document.querySelector(
      'textarea[placeholder="model_page.fields.extra_headers.placeholder"]',
    );
    if (!(headers instanceof HTMLTextAreaElement)) {
      throw new Error("自定义请求头输入框未挂载。");
    }
    expect(headers.readOnly).toBe(false);
    await act(async () => change_textarea_value(headers, '{"X-Test":"ok"}'));
    await act(async () => headers.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));

    expect(on_patch).toHaveBeenCalledWith({
      request: { extra_headers: { "X-Test": "ok" } },
    });
  });

  it("把 Agent 容量置顶并只原子提交合法数值对", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => {});
    const on_agent_limits_error = vi.fn();
    await act(async () => {
      root?.render(
        <ModelAdvancedSettingsDialog
          open
          model={create_model_snapshot()}
          readonly={false}
          onPatch={on_patch}
          onAgentLimitsError={on_agent_limits_error}
          onJsonFormatError={() => {}}
          onClose={() => {}}
        />,
      );
    });

    const number_field_labels = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    ].map((input) => input.getAttribute("aria-label"));
    expect(number_field_labels.slice(0, 2)).toEqual([
      "model_page.fields.context_window.title",
      "model_page.fields.max_output_tokens.title",
    ]);
    expect(document.body.textContent).toContain("model_page.fields.context_window.description");
    expect(document.body.textContent).toContain("model_page.fields.max_output_tokens.description");
    const context_window = document.querySelector<HTMLInputElement>(
      'input[aria-label="model_page.fields.context_window.title"]',
    );
    const max_output_tokens = document.querySelector<HTMLInputElement>(
      'input[aria-label="model_page.fields.max_output_tokens.title"]',
    );
    if (context_window === null || max_output_tokens === null) {
      throw new Error("Agent 容量输入框未挂载。");
    }
    expect(context_window.min).toBe("0");
    expect(max_output_tokens.min).toBe("0");
    expect(context_window.value).toBe("0");
    expect(max_output_tokens.value).toBe("0");

    await act(async () => change_input_value(context_window, "300000"));
    await act(async () =>
      context_window.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
    expect(on_patch).toHaveBeenLastCalledWith({
      agent: { context_window: 300_000, max_output_tokens: 0 },
    });

    on_patch.mockClear();
    await act(async () => change_input_value(context_window, "64000"));
    await act(async () =>
      context_window.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
    expect(on_patch).not.toHaveBeenCalled();
    expect(on_agent_limits_error).toHaveBeenCalledOnce();
    expect(context_window.value).toBe("64000");
    expect(context_window.getAttribute("aria-invalid")).toBe("true");
    expect(max_output_tokens.getAttribute("aria-invalid")).toBe("true");

    await act(async () => change_input_value(context_window, "300000"));
    expect(on_patch).toHaveBeenLastCalledWith({
      agent: { context_window: 300_000, max_output_tokens: 0 },
    });
    expect(context_window.getAttribute("aria-invalid")).toBeNull();
    expect(max_output_tokens.getAttribute("aria-invalid")).toBeNull();
  });

  it("不再显示已移除的惩罚参数", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ModelAdvancedSettingsDialog
          open
          model={create_model_snapshot()}
          readonly={false}
          onPatch={async () => {}}
          onAgentLimitsError={() => {}}
          onJsonFormatError={() => {}}
          onClose={() => {}}
        />,
      );
    });

    const visible_text = document.body.textContent ?? "";
    expect(visible_text).toContain("model_page.fields.top_p.title");
    expect(visible_text).toContain("model_page.fields.temperature.title");
    expect(visible_text).not.toContain("model_page.fields.presence_penalty.title");
    expect(visible_text).not.toContain("model_page.fields.frequency_penalty.title");
  });
});
