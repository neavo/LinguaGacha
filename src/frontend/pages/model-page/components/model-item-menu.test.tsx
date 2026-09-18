import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import { ModelItemMenu } from "./model-item-menu";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/widgets/app-dropdown-menu", () => ({
  AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuSeparator: () => <hr />,
  AppDropdownMenuItem: (props: {
    children: ReactNode;
    disabled?: boolean;
    onClick: () => void;
  }) => (
    <button disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

describe("ModelItemMenu", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  /** 挂载菜单并暴露页面回调，测试只观察可用操作。 */
  async function render_menu(overrides: Partial<ComponentProps<typeof ModelItemMenu>> = {}) {
    const props = {
      model: create_model_snapshot(),
      readonly: false,
      on_open_settings: vi.fn(),
      on_copy: vi.fn(),
      on_reset: vi.fn(),
      on_delete: vi.fn(),
      ...overrides,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<ModelItemMenu {...props} />));
    return props;
  }

  /** 用可见操作文案定位按钮，避免依赖组件样式和层级。 */
  function button(label: string): HTMLButtonElement | undefined {
    return [...container!.querySelectorAll("button")].find((item) => item.textContent === label);
  }

  it("支持的协议展示复制入口并提交操作", async () => {
    const props = await render_menu();
    await act(async () => {
      button("model_page.action.copy")!.click();
    });
    expect(props.on_copy).toHaveBeenCalledOnce();
  });

  it("SakuraLLM 隐藏复制入口", async () => {
    await render_menu({ model: create_model_snapshot({ api_format: "SakuraLLM" }) });
    expect(button("model_page.action.copy")).toBeUndefined();
  });

  it.each([true, false])("忙碌时禁用写操作并允许查看设置：can_reset=%s", async (can_reset) => {
    const props = await render_menu({
      readonly: true,
      model: create_model_snapshot({ can_reset }),
    });
    const copy = button("model_page.action.copy")!;
    const write = button(can_reset ? "app.action.reset" : "app.action.delete")!;
    expect(copy.disabled).toBe(true);
    expect(write.disabled).toBe(true);
    expect(button(can_reset ? "app.action.delete" : "app.action.reset")).toBeUndefined();
    await act(async () => {
      button("model_page.action.basic_settings")!.click();
    });
    expect(props.on_open_settings).toHaveBeenCalledWith("basic");
  });
});
