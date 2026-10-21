import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import { ModelTaskSettingsDialog } from "./model-task-settings-dialog";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("ModelTaskSettingsDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  /** 挂载真实输入控件，观察提交字段与权限边界。 */
  async function render_dialog(readonly: boolean, model = create_model_snapshot()) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => true);
    await act(async () =>
      root?.render(
        <ModelTaskSettingsDialog
          open
          model={model}
          readonly={readonly}
          onPatch={on_patch}
          onClose={() => {}}
        />,
      ),
    );
    return on_patch;
  }

  it("将输入收口为非负整数并限制在控件允许的范围内", async () => {
    const on_patch = await render_dialog(false);
    for (const field of ["concurrency_limit", "output_token_limit"]) {
      const input = document.querySelector<HTMLInputElement>(
        `input[aria-label="model_page.fields.${field}.title"]`,
      )!;
      const maximum = Number(input.max);
      for (const [text, expected] of [
        ["3.8", 3],
        ["-2", 0],
        [String(maximum + 1), maximum],
        ["", 0],
      ] as const) {
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
            input,
            text,
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(on_patch).toHaveBeenLastCalledWith({ threshold: { [field]: expected } });
      }
    }
  });

  it("OAuth 隐藏输出阈值，锁定时禁用其余输入", async () => {
    await render_dialog(true, create_model_snapshot({ auth_type: "oauth" }));
    expect(
      document.querySelector('input[aria-label="model_page.fields.output_token_limit.title"]'),
    ).toBeNull();
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input.disabled).toBe(true);
  });
});
