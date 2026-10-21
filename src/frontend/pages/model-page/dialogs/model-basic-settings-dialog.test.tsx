import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelBasicSettingsDialog } from "./model-basic-settings-dialog";
import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";

const { api_fetch_mock, translate } = vi.hoisted(() => ({
  api_fetch_mock: vi.fn(),
  translate: (key: string) => key, // 与真实语言上下文一样保持稳定引用
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: api_fetch_mock,
}));

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ locale: "zh-CN", t: translate }),
}));

/** 按可见文案读取按钮，允许按钮同时展示快捷键提示。 */
function find_button(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  if (button === undefined) throw new Error(`按钮未挂载：${label}`);
  return button;
}

/** 读取当前打开的模型 ID 草稿输入框。 */
function find_model_id_input(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    'input[placeholder="model_page.fields.model_id.placeholder"]',
  );
}

/** 使用原生 setter 触发 React 受控输入。 */
function change_input_value(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 手动控制保存完成时机。 */
function create_deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promise_resolve) => {
    resolve = promise_resolve;
  });
  return { promise, resolve };
}

describe("ModelBasicSettingsDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    api_fetch_mock.mockReset();
    vi.useRealTimers();
  });

  /** 挂载或重渲染基础设置弹窗。 */
  async function render_basic(
    on_patch: (patch: Record<string, unknown>) => Promise<boolean>,
    open = true,
  ): Promise<void> {
    if (root === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => {
      root?.render(
        <ModelBasicSettingsDialog
          open={open}
          model={create_model_snapshot()}
          readonly={false}
          test_disabled
          onPatch={on_patch}
          onRequestTestModel={() => {}}
          onClose={() => {}}
        />,
      );
    });
  }

  it("手动输入保存成功后关闭，失败时保留草稿", async () => {
    const on_patch = vi.fn(async () => false);
    await render_basic(on_patch);
    await act(async () => find_button("model_page.action.input").click());
    await act(async () => change_input_value(find_model_id_input()!, "  next-model  "));
    await act(async () => find_button("app.action.confirm").click());

    expect(on_patch).toHaveBeenLastCalledWith({ model_id: "next-model" });
    expect(find_model_id_input()?.value).toBe("  next-model  ");

    on_patch.mockResolvedValue(true);
    await act(async () => find_button("app.action.confirm").click());
    expect(on_patch).toHaveBeenCalledTimes(2);
    expect(find_model_id_input()).toBeNull();
  });

  it("目录选择经确认保存后关闭，失败时保留选择器与选择", async () => {
    api_fetch_mock.mockResolvedValue({
      models: [
        { id: "alpha-model", name: "Alpha" },
        { id: "beta-model", name: "Beta" },
      ],
    });
    const on_patch = vi.fn(async () => false);
    await render_basic(on_patch);
    await act(async () => find_button("model_page.action.fetch").click());
    await act(async () => find_button("beta-model").click());
    expect(on_patch).not.toHaveBeenCalled();

    await act(async () => find_button("app.action.confirm").click());
    expect(on_patch).toHaveBeenLastCalledWith({ model_id: "beta-model" });
    expect(find_button("beta-model").getAttribute("aria-pressed")).toBe("true");

    on_patch.mockResolvedValue(true);
    await act(async () => find_button("app.action.confirm").click());
    expect(on_patch).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".model-page__selector-list")).toBeNull();
  });

  it("提交期间禁止重复提交与关闭", async () => {
    const pending = create_deferred<boolean>();
    const on_patch = vi.fn(() => pending.promise);
    await render_basic(on_patch);
    await act(async () => find_button("model_page.action.input").click());
    await act(async () => find_button("app.action.confirm").click());
    const confirm = find_button("app.action.confirm");
    expect(confirm.disabled).toBe(true);
    expect(find_button("app.action.cancel").disabled).toBe(true);
    await act(async () => confirm.click());
    expect(on_patch).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(true));
    expect(find_model_id_input()).toBeNull();
  });

  it("基础设置关闭后重开，编辑入口与选择器状态都会重置", async () => {
    api_fetch_mock.mockResolvedValue({ models: [{ id: "alpha-model", name: "Alpha" }] });
    const on_patch = vi.fn(async () => true);
    await render_basic(on_patch);
    await act(async () => find_button("model_page.action.fetch").click());
    expect(api_fetch_mock).toHaveBeenCalledTimes(1);

    await render_basic(on_patch, false);
    await render_basic(on_patch, true);
    expect(document.querySelector(".model-page__selector-list")).toBeNull();
    await act(async () => find_button("model_page.action.fetch").click());
    expect(api_fetch_mock).toHaveBeenCalledTimes(2);
  });

  it("接口地址预览包含当前项目作用域与模型", async () => {
    const api_url =
      "https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1";
    const model_id = "gemini-test";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ModelBasicSettingsDialog
          open
          model={create_model_snapshot({ api_format: "Google", api_url, model_id })}
          readonly={false}
          test_disabled={false}
          onPatch={async () => true}
          onRequestTestModel={() => {}}
          onClose={() => {}}
        />,
      );
    });

    expect(document.body.textContent).toContain(
      `${api_url}/publishers/google/models/${model_id}:streamGenerateContent?alt=sse`,
    );
  });

  it("打开的模型 ID 输入器在本地提交期间保持可选择且拒绝 Enter 提交", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => true);
    const render_dialog = async (readonly: boolean): Promise<void> => {
      await act(async () => {
        root?.render(
          <ModelBasicSettingsDialog
            test_disabled={true}
            open
            model={create_model_snapshot()}
            readonly={readonly}
            onPatch={on_patch}
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

  it("Responses 模型只显示并提交后端确认可用的思考等级", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_patch = vi.fn(async () => true);
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
    await act(async () => options[1]!.click());

    expect(on_patch).toHaveBeenCalledWith({ thinking: { level: "HIGH" } });
  });

  it.each(["OpenAIResponses", "OpenAI"] as const)(
    "%s 按协议展示速度选项并保存",
    async (api_format) => {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      const on_patch = vi.fn(async () => true);
      await act(async () => {
        root?.render(
          <ModelBasicSettingsDialog
            open
            test_disabled
            model={create_model_snapshot({ api_format })}
            readonly={false}
            onPatch={on_patch}
            onRequestTestModel={() => {}}
            onClose={() => {}}
          />,
        );
      });
      const triggers = [
        ...document.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]'),
      ];
      const speed = triggers.find((item) =>
        item.textContent?.includes("model_page.fields.speed.default"),
      );
      if (api_format !== "OpenAIResponses") {
        expect(speed).toBeUndefined();
        return;
      }
      expect(speed).toBeDefined();
      await act(async () => speed!.click());
      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      const default_option = options.find(
        (item) => item.textContent === "model_page.fields.speed.default",
      )!;
      const ultrafast_option = options.find(
        (item) => item.textContent === "model_page.fields.speed.ultrafast",
      )!;
      vi.useFakeTimers();
      await act(async () => {
        default_option.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        default_option.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        vi.runAllTimers();
      });
      expect(document.querySelector('[role="tooltip"][data-open]')?.textContent).toBe(
        "model_page.fields.speed.default_description",
      );
      vi.useRealTimers();
      await act(async () => ultrafast_option.click());
      expect(on_patch).toHaveBeenCalledWith({ request: { speed_level: "ULTRAFAST" } });
    },
  );

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
          onPatch={async () => true}
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
