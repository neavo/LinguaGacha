import { act, type InputHTMLAttributes, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@frontend/widgets/interactions/use-debounce";
import { ModelSelectorDialog } from "@frontend/pages/model-page/dialogs/model-selector-dialog";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";

vi.mock("@frontend/app/locale/locale-provider", () => {
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

vi.mock("@frontend/shadcn/scroll-area", () => {
  return {
    ScrollArea: (props: { children: ReactNode; className?: string }) => (
      <div className={props.className}>{props.children}</div>
    ),
  };
});

vi.mock("@frontend/widgets/app-page-dialog", () => {
  return {
    AppPageDialog: (props: {
      children: ReactNode;
      open: boolean;
      title: string;
      onClose: () => void;
    }) => {
      if (!props.open) {
        return null;
      }

      return (
        <section aria-label={props.title}>
          <button type="button" onClick={props.onClose}>
            关闭
          </button>
          {props.children}
        </section>
      );
    },
  };
});

function change_input_value(input: HTMLInputElement, value: string): void {
  const value_descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  value_descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function read_option_texts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".model-page__selector-item")).map((button) => {
    return button.textContent ?? "";
  });
}
function ModelSelectorProbe(props: {
  on_load_available_models: (model_id: string) => Promise<void>;
}): JSX.Element {
  const [filter_text, set_filter_text] = useState("");

  return (
    <ModelSelectorDialog
      open={true}
      model={create_model_snapshot()}
      available_models={["alpha-model", "beta-model", "gamma-model"]}
      filter_text={filter_text}
      is_loading={false}
      onFilterTextChange={set_filter_text}
      onLoadAvailableModels={props.on_load_available_models}
      onSelectModelId={async () => {}}
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

  async function render_dialog(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ModelSelectorProbe on_load_available_models={vi.fn(async () => {})} />);
    });
  }

  it("模型筛选输入即时显示，本地模型列表在 250ms 后刷新", async () => {
    vi.useFakeTimers();
    await render_dialog();
    if (container === null) {
      throw new Error("模型选择器容器未挂载。");
    }

    expect(read_option_texts(container)).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    const input = container.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("模型筛选输入框未挂载。");
    }

    await act(async () => {
      change_input_value(input, "beta");
    });

    expect(input.value).toBe("beta");
    expect(read_option_texts(container)).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    expect(read_option_texts(container)).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(read_option_texts(container)).toEqual(["beta-model"]);
  });
});
