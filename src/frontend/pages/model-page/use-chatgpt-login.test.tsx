import { act, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apply_model_auth_snapshot } from "@frontend/app/state/model-auth-store";
import type { ChatGPTAuthSnapshot, ChatGPTLoginResponse } from "@shared/model-auth";
import { ChatGPTLoginDialog } from "./dialogs/chatgpt-login-dialog";
import { useChatGPTLogin } from "./use-chatgpt-login";

const mocks = vi.hoisted(() => ({ api: vi.fn(), open: vi.fn(), toast: vi.fn() }));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
  open_external_url: mocks.open,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.toast,
  push_toast: mocks.toast,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

let root: Root;
let container: HTMLDivElement;
let snapshot: ChatGPTAuthSnapshot;
let response: ChatGPTLoginResponse;

/** 用真实弹窗观察 Hook 的跨请求生命周期和最终用户反馈。 */
function LoginPage(): JSX.Element {
  const login = useChatGPTLogin();
  return (
    <>
      <button
        disabled={login.busy}
        onClick={() => {
          void login.start();
        }}
      >
        start
      </button>
      <ChatGPTLoginDialog login={login} />
    </>
  );
}

/** 按用户可见名称定位动作，缺失时给出明确错误。 */
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

/** 点击后等待 React 提交对应状态。 */
async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}

beforeEach(async () => {
  mocks.api.mockReset();
  mocks.open.mockReset();
  mocks.toast.mockReset();
  snapshot = {
    instance_id: crypto.randomUUID(),
    revision: 1,
    connected: false,
    login: { id: "first", status: "pending" },
  };
  response = {
    id: "first",
    url: "https://auth.openai.com/api/accounts/authorize?state=first",
    snapshot,
  };
  apply_model_auth_snapshot({ ...snapshot, revision: 0, login: null });
  mocks.api.mockImplementation(async (route: string) =>
    route.endsWith("/cancel")
      ? { snapshot: { ...snapshot, revision: 2, login: { id: "first", status: "cancelled" } } }
      : response,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<LoginPage />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("ChatGPT 登录交互", () => {
  it("只读授权链接可复制或交给默认浏览器打开", async () => {
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await click("start");
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const input = dialog.querySelector("input")!;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(response.url);
    expect(mocks.open).not.toHaveBeenCalled();
    await click("model_page.auth.copy_link");
    expect(copy).toHaveBeenCalledWith(response.url);
    expect(button("model_page.auth.copied")).toBeDefined();
    expect(mocks.open).not.toHaveBeenCalled();
    await click("model_page.auth.open_login_page");
    expect(mocks.open).toHaveBeenCalledWith(response.url);
    expect(button("app.action.cancel")).toBeDefined();
  });

  it("准备期间取消等待启动收尾，重开以后旧结果无法结束新窗口", async () => {
    const pending = Promise.withResolvers<ChatGPTLoginResponse>();
    mocks.api.mockReturnValueOnce(pending.promise);
    await click("start");
    expect(button("model_page.auth.open_login_page").disabled).toBe(true);
    expect(button("model_page.auth.copy_link").disabled).toBe(true);
    await click("app.action.cancel");
    expect(button("start").disabled).toBe(true);
    await act(async () => {
      pending.resolve(response);
    });
    expect(mocks.api).toHaveBeenCalledWith("/api/models/auth/cancel", { id: "first" });
    expect(button("start").disabled).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
    response = {
      ...response,
      id: "second",
      url: "https://auth.openai.com/authorize?state=second",
      snapshot: { ...snapshot, revision: 3, login: { id: "second", status: "pending" } },
    };
    const next = Promise.withResolvers<ChatGPTLoginResponse>();
    mocks.api.mockReturnValueOnce(next.promise);
    await click("start");
    // 前一轮取消的 SSE 晚于 HTTP 到达，新一轮此时尚未取得授权 ID。
    await act(async () => {
      apply_model_auth_snapshot({
        ...snapshot,
        revision: 2,
        login: { id: "first", status: "cancelled" },
      });
    });
    expect(button("start").disabled).toBe(true);
    expect(button("app.action.cancel")).toBeDefined();
    await act(async () => {
      next.resolve(response);
    });
    expect(document.querySelector("input")?.value).toBe(response.url);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("成功事件先于启动响应时仍能关闭弹窗，重连重复快照只提示一次", async () => {
    const pending = Promise.withResolvers<ChatGPTLoginResponse>();
    mocks.api.mockReturnValueOnce(pending.promise);
    await click("start");
    const completed: ChatGPTAuthSnapshot = {
      ...snapshot,
      revision: 2,
      connected: true,
      login: { id: "first", status: "succeeded" },
    };
    await act(async () => {
      apply_model_auth_snapshot(completed);
      pending.resolve(response);
    });
    expect(button("start").disabled).toBe(false);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("success", "model_page.auth.success");
    await act(async () => {
      apply_model_auth_snapshot(completed);
    });
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.api).not.toHaveBeenCalledWith("/api/models/auth/cancel", expect.anything());
  });

  it("授权失败通过 Toast 结束窗口", async () => {
    const message = "fixture authorization failure";
    await click("start");
    await act(async () => {
      apply_model_auth_snapshot({
        ...snapshot,
        revision: 2,
        login: {
          id: "first",
          status: "failed",
          error: { code: "model.provider_failed", message },
        },
      });
    });
    expect(button("start").disabled).toBe(false);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      "app.feedback.model_request_failed",
      expect.any(Error),
    );
  });

  it("准备链接失败只提示一次，按钮恢复为可以重新登录", async () => {
    mocks.api.mockRejectedValueOnce(new Error("listener failed"));
    await click("start");
    expect(button("start").disabled).toBe(false);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    await click("start");
    expect(document.querySelector("input")?.value).toBe(response.url);
  });

  it("剪贴板和浏览器操作失败保留当前授权窗口", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard failed"));
    mocks.open.mockRejectedValue(new Error("browser failed"));
    await click("start");
    await click("model_page.auth.copy_link");
    await click("model_page.auth.open_login_page");
    expect(mocks.toast).toHaveBeenCalledTimes(2);
    expect(document.querySelector("input")?.value).toBe(response.url);
  });

  it("页面卸载取消对应授权，取消与提交竞争时应用后端成功结果", async () => {
    await click("start");
    mocks.api.mockResolvedValueOnce({
      snapshot: {
        ...snapshot,
        revision: 2,
        connected: true,
        login: { id: "first", status: "succeeded" },
      },
    });
    await click("app.action.cancel");
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("success", "model_page.auth.success");
    response = {
      ...response,
      id: "second",
      snapshot: { ...snapshot, revision: 3, login: { id: "second", status: "pending" } },
    };
    await click("start");
    await act(async () => root.unmount());
    expect(
      mocks.api.mock.calls.filter(([route]) => route === "/api/models/auth/cancel"),
    ).toHaveLength(2);
    root = createRoot(container);
  });
});
