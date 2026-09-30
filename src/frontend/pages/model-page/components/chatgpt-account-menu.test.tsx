import { act } from "react";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatGPTAccountMenu } from "./chatgpt-account-menu";
import { apply_model_auth_snapshot } from "@frontend/app/state/model-auth-store";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  open: vi.fn(),
  toast: vi.fn(),
  logout: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: mocks.api,
  open_external_url: mocks.open,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: mocks.toast }));
vi.mock("@frontend/app/locale/locale-context", () => ({ useI18n: () => ({ t: mocks.t }) }));

let container: HTMLDivElement;
let root: Root;
const disconnected = {
  instance_id: "component-test",
  revision: 0,
  connected: false,
};
beforeEach(() => {
  mocks.api.mockReset();
  mocks.open.mockReset();
  mocks.toast.mockReset();
  mocks.logout.mockReset();
  mocks.api.mockResolvedValue({ snapshot: disconnected });
  apply_model_auth_snapshot({ ...disconnected, instance_id: String(Math.random()) });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** 通过真实菜单承载账户动作，观察浏览器启动与页面退出回调。 */
async function render_menu(readonly = false): Promise<void> {
  await act(async () =>
    root.render(
      <AppDropdownMenu open>
        <AppDropdownMenuTrigger>菜单</AppDropdownMenuTrigger>
        <AppDropdownMenuContent>
          <ChatGPTAccountMenu readonly={readonly} on_logout={mocks.logout}>
            {null}
          </ChatGPTAccountMenu>
        </AppDropdownMenuContent>
      </AppDropdownMenu>,
    ),
  );
}
/** 按可见操作名称定位菜单项。 */
function item(key: string): HTMLElement {
  const result = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (element) => element.textContent === key,
  );
  if (!result) throw new Error(`Menu item missing: ${key}`);
  return result;
}

describe("ChatGPT 账户菜单", () => {
  it("授权进行中仍显示点击登录，重复点击复用同一授权页面，成功后显示退出登录", async () => {
    await render_menu();
    const url = "https://auth.openai.com/authorize";
    mocks.api.mockResolvedValue({ url });
    await act(async () => item("model_page.auth.login").click());
    expect(item("model_page.auth.login")).toBeDefined();
    await act(async () => item("model_page.auth.login").click());
    expect(mocks.open.mock.calls).toEqual([[url], [url]]);
    await act(async () =>
      apply_model_auth_snapshot({
        ...disconnected,
        revision: 2,
        connected: true,
      }),
    );
    expect(item("model_page.auth.logout")).toBeDefined();
    expect(
      mocks.api.mock.calls.some(
        ([route]) => route === "/api/models/list-available" || route === "/api/models/test",
      ),
    ).toBe(false);
  });

  it("登录失败使用 Toast，运行期间登录不可用", async () => {
    await render_menu();
    mocks.api.mockRejectedValueOnce(new Error("login failed"));
    await act(async () => item("model_page.auth.login").click());
    expect(mocks.toast).toHaveBeenCalledWith("error", "login failed");
    await render_menu(true);
    expect(item("model_page.auth.login").getAttribute("aria-disabled")).toBe("true");
  });

  it("已登录时只有退出入口，点击只请求页面确认", async () => {
    mocks.api.mockResolvedValue({ snapshot: { ...disconnected, revision: 1, connected: true } });
    await render_menu();
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
    expect(document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull();
    mocks.api.mockClear();
    await act(async () => item("model_page.auth.logout").click());
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
