import { act, type InputHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INPUT_QUERY_DEBOUNCE_MS } from "@frontend/widgets/interactions/use-debounce";
import { ModelSelectorDialog } from "@frontend/pages/model-page/dialogs/model-selector-dialog";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import type { ModelListResult } from "@shared/model-catalog";

const { api_fetch_mock, push_toast, translate } = vi.hoisted(() => ({
  api_fetch_mock: vi.fn(),
  push_toast: vi.fn(),
  translate: (key: string) => key, // 与真实语言上下文一样保持稳定引用
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: api_fetch_mock,
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: push_toast,
  push_toast,
}));

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: translate }),
}));

vi.mock("@frontend/shadcn/input", () => {
  return {
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  };
});

const DEFAULT_CATALOG: ModelListResult = {
  models: ["alpha-model", "beta-model", "gamma-model"].map((id) => ({
    id,
    name: "Display title",
  })),
};

/** 使用原生 setter 触发 React 受控输入，避免只修改 DOM 值。 */
function change_input_value(input: HTMLInputElement, value: string): void {
  const value_descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  value_descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 读取当前显示的模型选项。 */
function read_option_texts(): string[] {
  return Array.from(document.querySelectorAll(".model-page__selector-item"), (item) => {
    return item.textContent ?? "";
  });
}

/** 按模型 ID 读取列表选项。 */
function read_option(model_id: string): HTMLButtonElement {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".model-page__selector-item"),
  ).find((item) => item.textContent === model_id)!;
}

/** 读取当前选中的选项文本。 */
function read_selected_texts(): string[] {
  return Array.from(
    document.querySelectorAll('.model-page__selector-item[aria-pressed="true"]'),
    (item) => {
      return item.textContent ?? "";
    },
  );
}

/** 按文案读取底栏按钮。 */
function read_footer_button(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.startsWith(label),
  )!;
}

/** 手动控制目录查询完成时机。 */
function create_deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((promise_resolve, promise_reject) => {
    resolve = promise_resolve;
    reject = promise_reject;
  });
  return { promise, resolve, reject };
}

type RenderOptions = {
  model?: ModelEntrySnapshot;
  readonly?: boolean;
  submitting?: boolean;
  on_confirm?: (model_id: string) => void;
};

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
    api_fetch_mock.mockReset();
    push_toast.mockReset();
    vi.useRealTimers();
  });

  /** 卸载当前弹窗，模拟编辑入口关闭。 */
  async function unmount_dialog(): Promise<void> {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  }

  /** 挂载或重渲染真实弹窗，覆盖 Portal 与底栏行为。 */
  async function render_dialog(options: RenderOptions = {}): Promise<void> {
    if (root === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <ModelSelectorDialog
          model={options.model ?? create_model_snapshot()}
          readonly={options.readonly ?? false}
          submitting={options.submitting ?? false}
          onConfirm={options.on_confirm ?? (() => {})}
          onClose={() => {}}
        />,
      );
    });
  }

  it("按配置条目查询目录，筛选在防抖到期后刷新且不改变选择", async () => {
    vi.useFakeTimers();
    api_fetch_mock.mockResolvedValue(DEFAULT_CATALOG);
    await render_dialog();

    expect(api_fetch_mock).toHaveBeenCalledExactlyOnceWith("/api/models/list-available", {
      model_id: "model-1",
    });
    expect(read_option_texts()).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    const input = document.body.querySelector<HTMLInputElement>("input")!;
    await act(async () => change_input_value(input, "beta"));

    expect(input.value).toBe("beta");
    expect(read_option_texts()).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    expect(read_option_texts()).toEqual(["alpha-model", "beta-model", "gamma-model"]);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(read_option_texts()).toEqual(["beta-model"]);
    expect(read_footer_button("app.action.confirm").disabled).toBe(false); // 默认选中项被筛选隐藏后仍是有效选择
  });

  it("默认选中当前模型 ID，点击列表只改选择，确认才提交", async () => {
    api_fetch_mock.mockResolvedValue(DEFAULT_CATALOG);
    const on_confirm = vi.fn();
    await render_dialog({ on_confirm });

    expect(read_selected_texts()).toEqual(["alpha-model"]);
    await act(async () => read_option("beta-model").click());
    await act(async () => read_option("beta-model").click());
    expect(read_selected_texts()).toEqual(["beta-model"]);
    expect(on_confirm).not.toHaveBeenCalled();

    await act(async () => read_footer_button("app.action.confirm").click());
    expect(on_confirm).toHaveBeenCalledExactlyOnceWith("beta-model");
  });

  it("当前模型 ID 不在目录中时保持未选", async () => {
    api_fetch_mock.mockResolvedValue(DEFAULT_CATALOG);
    await render_dialog({ model: create_model_snapshot({ model_id: "custom" }) });

    expect(read_selected_texts()).toEqual([]);
    expect(read_footer_button("app.action.confirm").disabled).toBe(true);
  });

  it("加载中、只读与提交期间禁用确认和选择", async () => {
    const pending = create_deferred<ModelListResult>();
    api_fetch_mock.mockReturnValue(pending.promise);
    await render_dialog();
    expect(read_footer_button("app.action.confirm").disabled).toBe(true);
    await act(async () => pending.resolve(DEFAULT_CATALOG));
    expect(read_footer_button("app.action.confirm").disabled).toBe(false);

    for (const state of [{ readonly: true }, { submitting: true }]) {
      await render_dialog(state);
      expect(read_footer_button("app.action.confirm").disabled).toBe(true);
      const options = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".model-page__selector-item"),
      );
      expect(options.every((option) => option.disabled)).toBe(true);
    }
    expect(read_footer_button("app.action.cancel").disabled).toBe(true);
  });

  it("关闭重开后丢弃上一轮的迟到结果与失败通知", async () => {
    const stale = create_deferred<ModelListResult>();
    api_fetch_mock
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ models: [{ id: "fresh", name: "Fresh" }] });
    await render_dialog();
    await unmount_dialog();
    await render_dialog();
    await act(async () => stale.reject(new Error("late failure")));
    expect(read_option_texts()).toEqual(["fresh"]);
    expect(push_toast).not.toHaveBeenCalled();
  });
});
