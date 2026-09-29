import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { create_text_resolver, type LocaleKey } from "@shared/i18n";
import { AppDropdownMenu, AppDropdownMenuTrigger } from "@frontend/widgets/app-dropdown-menu";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import { ModelItemMenu } from "./model-item-menu";

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
    await act(async () =>
      root?.render(
        <LocaleProvider locale="zh-CN">
          <AppDropdownMenu open>
            <AppDropdownMenuTrigger>菜单</AppDropdownMenuTrigger>
            <ModelItemMenu {...props} />
          </AppDropdownMenu>
        </LocaleProvider>,
      ),
    );
    return props;
  }

  /** 用可见操作文案定位按钮，避免依赖组件样式和层级。 */
  function menu_item(key: LocaleKey): HTMLElement | undefined {
    const label = create_text_resolver("zh-CN")(key);
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === label,
    );
  }

  it("支持的协议展示复制入口并提交操作", async () => {
    const props = await render_menu();
    await act(async () => {
      menu_item("model_page.action.copy")!.click();
    });
    expect(props.on_copy).toHaveBeenCalledOnce();
  });

  it("SakuraLLM 隐藏复制入口", async () => {
    await render_menu({ model: create_model_snapshot({ api_format: "SakuraLLM" }) });
    expect(menu_item("model_page.action.copy")).toBeUndefined();
  });

  it.each([true, false])("忙碌时禁用写操作并允许查看设置：can_reset=%s", async (can_reset) => {
    const props = await render_menu({
      readonly: true,
      model: create_model_snapshot({ can_reset }),
    });
    const copy = menu_item("model_page.action.copy")!;
    const write = menu_item(can_reset ? "app.action.reset" : "app.action.delete")!;
    expect(copy.getAttribute("aria-disabled")).toBe("true");
    expect(write.getAttribute("aria-disabled")).toBe("true");
    expect(menu_item(can_reset ? "app.action.delete" : "app.action.reset")).toBeUndefined();
    await act(async () => {
      copy.click();
      write.click();
      menu_item("model_page.action.basic_settings")!.click();
    });
    expect(props.on_open_settings).toHaveBeenCalledWith("basic");
    expect(props.on_copy).not.toHaveBeenCalled();
    expect(props.on_reset).not.toHaveBeenCalled();
    expect(props.on_delete).not.toHaveBeenCalled();
  });
});
