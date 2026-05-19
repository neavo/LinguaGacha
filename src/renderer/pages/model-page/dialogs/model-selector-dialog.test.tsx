import { act, type InputHTMLAttributes, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@/hooks/use-debounce";
import { ModelSelectorDialog } from "@/pages/model-page/dialogs/model-selector-dialog";
import type { ModelEntrySnapshot } from "@/pages/model-page/types";

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/shadcn/input", () => {
  return {
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  };
});

vi.mock("@/shadcn/scroll-area", () => {
  return {
    ScrollArea: (props: { children: ReactNode; className?: string }) => (
      <div className={props.className}>{props.children}</div>
    ),
  };
});

vi.mock("@/widgets/app-page-dialog/app-page-dialog", () => {
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

function create_model_snapshot(): ModelEntrySnapshot {
  return {
    id: "model-1",
    type: "PRESET",
    name: "默认模型",
    api_format: "OpenAI",
    api_url: "",
    api_key: "",
    model_id: "alpha-model",
    request: {
      extra_headers: {},
      extra_headers_custom_enable: false,
      extra_body: {},
      extra_body_custom_enable: false,
    },
    threshold: {
      input_token_limit: 0,
      output_token_limit: 0,
      rpm_limit: 0,
      concurrency_limit: 0,
    },
    thinking: {
      level: "OFF",
    },
    generation: {
      temperature: 1,
      temperature_custom_enable: false,
      top_p: 1,
      top_p_custom_enable: false,
      presence_penalty: 0,
      presence_penalty_custom_enable: false,
      frequency_penalty: 0,
      frequency_penalty_custom_enable: false,
    },
  };
}

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
