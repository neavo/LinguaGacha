import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { create_text_resolver, type LocaleKey } from "@shared/i18n";
import { AppDropdownMenu, AppDropdownMenuTrigger } from "@frontend/widgets/app-dropdown-menu";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_model_snapshot } from "@frontend/pages/model-page/model-test-fixture";
import { ModelItemMenu } from "./model-item-menu";
import { apply_model_auth_snapshot } from "@frontend/app/state/model-auth-store";

const { api_fetch_mock } = vi.hoisted(() => ({ api_fetch_mock: vi.fn() }));
vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: api_fetch_mock,
}));

describe("ModelItemMenu", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    api_fetch_mock.mockReset();
  });

  /** 挂载菜单并暴露页面回调，测试只观察可用操作。 */
  async function render_menu(overrides: Partial<ComponentProps<typeof ModelItemMenu>> = {}) {
    const props = {
      model: create_model_snapshot(),
      readonly: false,
      auth_disabled: false,
      on_open_settings: vi.fn(),
      on_copy: vi.fn(),
      on_reset: vi.fn(),
      on_delete: vi.fn(),
      on_logout: vi.fn(),
      on_login: vi.fn(),
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

  it("OAuth 账户入口随连接状态切换并转交页面操作", async () => {
    const snapshot = { instance_id: "menu-login", revision: 0, login: null, connected: false };
    apply_model_auth_snapshot(snapshot);
    api_fetch_mock.mockResolvedValue({ snapshot });
    const props = await render_menu({ model: create_model_snapshot({ auth_type: "oauth" }) });
    await act(async () => {
      menu_item("model_page.auth.login")!.click();
    });
    expect(props.on_login).toHaveBeenCalledOnce();
    await act(async () => apply_model_auth_snapshot({ ...snapshot, revision: 1, connected: true }));
    expect(menu_item("model_page.auth.login")).toBeUndefined();
    await act(async () => {
      menu_item("model_page.auth.logout")!.click();
    });
    expect(props.on_logout).toHaveBeenCalledOnce();
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
    const write = menu_item(can_reset ? "model_page.action.reset" : "model_page.action.delete")!;
    expect(copy.getAttribute("aria-disabled")).toBe("true");
    expect(write.getAttribute("aria-disabled")).toBe("true");
    expect(
      menu_item(can_reset ? "model_page.action.delete" : "model_page.action.reset"),
    ).toBeUndefined();
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
