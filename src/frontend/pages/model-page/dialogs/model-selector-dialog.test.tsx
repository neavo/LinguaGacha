import { type JSX, act, type InputHTMLAttributes, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@frontend/widgets/interactions/use-debounce";
import { ModelSelectorDialog } from "@frontend/pages/model-page/dialogs/model-selector-dialog";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import type { AvailableModel } from "@shared/model-catalog";

vi.mock("@frontend/app/locale/locale-context", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/shadcn/input", () => {
  return {
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  };
});

/** 使用原生 setter 触发 React 受控输入，避免只修改 DOM 值。 */
function change_input_value(input: HTMLInputElement, value: string): void {
  const value_descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  value_descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 读取模型选项，排除弹窗的其他操作按钮。 */
function read_option_texts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".model-page__selector-item")).map((button) => {
    return button.textContent ?? "";
  });
}
type ModelSelectorProbeProps = {
  on_load_available_models: (model_id: string) => Promise<void>;
  available_models?: AvailableModel[];
  readonly?: boolean;
  on_select?: (model_id: string) => Promise<void>;
};
/** 由宿主维护筛选值，让测试观察真实的受控输入行为。 */
function ModelSelectorProbe(props: ModelSelectorProbeProps): JSX.Element {
  const [filter_text, set_filter_text] = useState("");

  return (
    <ModelSelectorDialog
      open={true}
      model={create_model_snapshot()}
      readonly={props.readonly ?? false}
      available_models={
        props.available_models ??
        ["alpha-model", "beta-model", "gamma-model"].map((id) => ({
          id,
          name: "Display title",
        }))
      }
      filter_text={filter_text}
      is_loading={false}
      onFilterTextChange={set_filter_text}
      onLoadAvailableModels={props.on_load_available_models}
      onSelectModelId={props.on_select ?? (async () => {})}
      onClose={() => {}}
    />
  );
}

describe("ModelSelectorDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  /** 挂载真实弹窗，覆盖 Portal 与默认页脚行为。 */
  async function render_dialog(props: Partial<ModelSelectorProbeProps> = {}): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ModelSelectorProbe on_load_available_models={vi.fn(async () => {})} {...props} />,
      );
    });
  }

  it("列表显示模型 ID，筛选输入即时显示且列表在防抖到期后刷新", async () => {
    vi.useFakeTimers();
    await render_dialog();
    if (container === null) {
      throw new Error("模型选择器容器未挂载。");
    }

    expect(read_option_texts(document.body)).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    const input = document.body.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("模型筛选输入框未挂载。");
    }

    await act(async () => {
      change_input_value(input, "beta");
    });

    expect(input.value).toBe("beta");
    expect(read_option_texts(document.body)).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    expect(read_option_texts(document.body)).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(read_option_texts(document.body)).toEqual(["beta-model"]);
  });

  it("弹窗只提供列表选择，点击模型直接提交", async () => {
    const select = vi.fn(async () => {});
    await render_dialog({ on_select: select });
    const dialog = document.querySelector('[data-slot="dialog-content"]')!;
    expect(Array.from(dialog.querySelectorAll("button"), (button) => button.textContent)).toEqual([
      "alpha-model",
      "beta-model",
      "gamma-model",
    ]);
    const option = dialog.querySelector<HTMLButtonElement>(".model-page__selector-item")!;
    await act(async () => option.click());
    expect(select).toHaveBeenCalledExactlyOnceWith("alpha-model");
  });

  it("空目录保留空状态，输入关键词不会提交模型", async () => {
    const select = vi.fn(async () => {});
    await render_dialog({ available_models: [], on_select: select });
    const dialog = document.querySelector('[data-slot="dialog-content"]')!;
    expect(dialog.textContent).toContain("model_page.dialog.selector.empty");
    const input = dialog.querySelector("input")!;
    await act(async () => change_input_value(input, "custom-model"));
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(select).not.toHaveBeenCalled();
  });

  it("只读时目录选择禁用", async () => {
    const select = vi.fn(async () => {});
    await render_dialog({ readonly: true, on_select: select });
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".model-page__selector-item"),
    );
    expect(buttons.every((button) => button.disabled)).toBe(true);
    await act(async () => buttons[0]!.click());
    expect(select).not.toHaveBeenCalled();
  });
});
