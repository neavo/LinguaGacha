import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_COMPACTION_RESERVE_TOKENS } from "@domain/model-agent";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";

import { ModelAdvancedSettingsDialog } from "./model-advanced-settings-dialog";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string) => key,
  }),
}));

vi.mock("@frontend/app/appearance/appearance-provider", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));

/** 通过原生 value setter 触发 React 受控 input 的 input 事件。 */
function change_input_value(input: HTMLInputElement, value: string): void {
  const value_descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  value_descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 从公开可访问名称定位 CodeMirror，以真实编辑事务验证页面提交边界。 */
function get_request_json_editor(label: string): EditorView {
  const content = document.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`);
  const editor = content === null ? null : EditorView.findFromDOM(content);
  if (editor === null) {
    throw new Error(`缺少请求 JSON 编辑器：${label}`);
  }
  return editor;
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
    const on_json_format_error = vi.fn();
    const base_model = create_model_snapshot();
    const render_dialog = async (custom_enabled: boolean): Promise<void> => {
      await act(async () => {
        root?.render(
          <ModelAdvancedSettingsDialog
            open
            model={create_model_snapshot({
              request: {
                ...base_model.request,
                extra_headers: {},
                extra_body: {},
                extra_headers_custom_enable: custom_enabled,
                extra_body_custom_enable: custom_enabled,
              },
            })}
            readonly={false}
            onPatch={on_patch}
            onAgentLimitsAdjusted={() => {}}
            onJsonFormatError={on_json_format_error}
            onClose={() => {}}
          />,
        );
      });
    };

    await render_dialog(false);
    const readonly_headers = get_request_json_editor("model_page.fields.extra_headers.title");
    const readonly_body = get_request_json_editor("model_page.fields.extra_body.title");
    expect(readonly_headers.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(readonly_body.contentDOM.getAttribute("contenteditable")).toBe("false");
    readonly_headers.contentDOM.focus();
    readonly_headers.contentDOM.blur();
    readonly_body.contentDOM.focus();
    readonly_body.contentDOM.blur();
    expect(on_patch).not.toHaveBeenCalled();

    await render_dialog(true);
    const headers = get_request_json_editor("model_page.fields.extra_headers.title");
    expect(headers.contentDOM.getAttribute("contenteditable")).toBe("true");

    await act(async () => {
      headers.dispatch({
        changes: { from: 0, to: headers.state.doc.length, insert: '{"X-Test":}' },
      });
    });
    await act(async () => {
      headers.contentDOM.focus();
      headers.contentDOM.blur();
    });
    expect(on_json_format_error).toHaveBeenCalledOnce();
    expect(headers.contentDOM.getAttribute("aria-invalid")).toBe("true");
    expect(on_patch).not.toHaveBeenCalled();

    await act(async () => {
      headers.dispatch({
        changes: { from: 0, to: headers.state.doc.length, insert: '{"X-Test": "ok value"}' },
      });
    });
    await act(async () => {
      headers.contentDOM.focus();
      headers.contentDOM.blur();
    });

    expect(on_patch).toHaveBeenCalledWith({
      request: { extra_headers: { "X-Test": "ok value" } },
    });
    expect(headers.contentDOM.getAttribute("aria-invalid")).toBe("false");
  });

  it("保留后端自动输出语义，并把不可用显式组合整组恢复自动", async () => {
    const available_output_tokens = 10_000;
    const adjusted_context_window = AGENT_COMPACTION_RESERVE_TOKENS + available_output_tokens;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => {});
    const on_agent_limits_adjusted = vi.fn();
    await act(async () => {
      root?.render(
        <ModelAdvancedSettingsDialog
          open
          model={create_model_snapshot()}
          readonly={false}
          onPatch={on_patch}
          onAgentLimitsAdjusted={on_agent_limits_adjusted}
          onJsonFormatError={() => {}}
          onClose={() => {}}
        />,
      );
    });

    const context_window = document.querySelector<HTMLInputElement>(
      'input[aria-label="model_page.fields.context_window.title"]',
    );
    const max_output_tokens = document.querySelector<HTMLInputElement>(
      'input[aria-label="model_page.fields.max_output_tokens.title"]',
    );
    if (context_window === null || max_output_tokens === null) {
      throw new Error("Agent 容量输入框未挂载。");
    }
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
    await act(async () => change_input_value(context_window, adjusted_context_window.toString()));
    await act(async () =>
      context_window.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
    expect(on_patch).toHaveBeenLastCalledWith({
      agent: {
        context_window: adjusted_context_window,
        max_output_tokens: 0,
      },
    });
    expect(on_agent_limits_adjusted).not.toHaveBeenCalled();
    expect(context_window.value).toBe(adjusted_context_window.toString());
    expect(max_output_tokens.value).toBe("0");
    expect(context_window.getAttribute("aria-invalid")).toBeNull();
    expect(max_output_tokens.getAttribute("aria-invalid")).toBeNull();

    await act(async () => {
      root?.render(
        <ModelAdvancedSettingsDialog
          open
          model={create_model_snapshot({
            agent: {
              context_window: adjusted_context_window,
              max_output_tokens: available_output_tokens,
            },
          })}
          readonly={false}
          onPatch={on_patch}
          onAgentLimitsAdjusted={on_agent_limits_adjusted}
          onJsonFormatError={() => {}}
          onClose={() => {}}
        />,
      );
    });
    on_patch.mockClear();
    await act(async () =>
      change_input_value(context_window, AGENT_COMPACTION_RESERVE_TOKENS.toString()),
    );
    await act(async () =>
      context_window.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
    expect(on_patch).toHaveBeenCalledWith({
      agent: { context_window: 0, max_output_tokens: 0 },
    });
    expect(on_agent_limits_adjusted).toHaveBeenCalledOnce();
    expect(context_window.value).toBe("0");
    expect(max_output_tokens.value).toBe("0");
    expect(context_window.getAttribute("aria-invalid")).toBeNull();
    expect(max_output_tokens.getAttribute("aria-invalid")).toBeNull();
  });
});
