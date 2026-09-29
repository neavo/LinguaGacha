import { act, StrictMode, useEffect, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./agent-markdown";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  blob: vi.fn(),
  toast: vi.fn(),
  mounts: vi.fn(),
  unmounts: vi.fn(),
  session: "session-1",
  saved: null as unknown,
  t: (key: string) => key,
  get: (): unknown => mocks.saved,
  set: (_key: string, value: unknown): void => {
    mocks.saved = value;
  },
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: mocks.api,
  open_external_url: vi.fn(),
  api_blob: mocks.blob,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: mocks.toast }));
vi.mock("@frontend/app/locale/locale-context", () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock("@frontend/app/appearance/appearance-context", () => ({
  useAppearance: () => ({ resolved_theme: "light" }),
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ agent_input_request: null }),
}));
vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentSessionId: () => mocks.session,
  useAgentControls: () => ({ pendingDecision: null }),
}));
vi.mock("@frontend/app/session/project-session-ui-state-context", () => ({
  useProjectSessionUiState: () => ({ get_page_ui_state: mocks.get, set_page_ui_state: mocks.set }),
}));
vi.mock("./agent-conversation", () => ({
  AgentConversation: function Conversation(): JSX.Element {
    useEffect(() => {
      mocks.mounts();
      return () => {
        mocks.unmounts();
      };
    }, []);
    return (
      <div>
        <textarea defaultValue="草稿" />
        <AgentMarkdown text="[报告](work/report.md)\n\n[附件](work/other.md)" streaming={false} />
      </div>
    );
  },
}));

import { AgentPage } from "./page";

describe("Agent 文档标签", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.blob.mockReset();
    mocks.blob.mockResolvedValue(new Blob([new Uint8Array([0, 255])], { type: "image/png" }));
    mocks.session = "session-1";
    mocks.saved = null;
    mocks.mounts.mockClear();
    mocks.unmounts.mockClear();
    mocks.toast.mockClear();
    mocks.api.mockReset();
    mocks.api.mockImplementation(async (_route: string, body: { path: string }) => ({
      sessionId: mocks.session,
      path: body.path,
      content: "# 结论\n\n报告正文\n\n[下一份](./other.md)",
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  /** 页面重渲染保留实例，用公开会话身份驱动切换。 */
  async function render(): Promise<void> {
    await act(async () => root.render(<AgentPage is_sidebar_collapsed={false} />));
  }
  /** 通过实际点击等待 React 更新完成。 */
  async function click(element: Element | null): Promise<void> {
    expect(element).not.toBeNull();
    await act(async () => (element as HTMLElement).click());
  }
  /** 从文件链接菜单进入用户动作。 */
  async function menu(path: string, action = "view"): Promise<void> {
    await click(container.querySelector(`a[href="${path}"]`));
    await click(
      [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === `agent_page.document.${action}`,
      ) ?? null,
    );
  }
  /** 按可见文件名定位标签，避免耦合 Tooltip 的实现。 */
  function tab(path: string): Element | null {
    return (
      [...container.querySelectorAll('[role="tab"]')].find(
        (element) => element.textContent === decodeURIComponent(path.split("/").at(-1)!),
      ) ?? null
    );
  }

  it("默认无标签栏，保存沿用旧接口，查看后文档独占页面且对话实例保持", async () => {
    await render();
    const list = container.querySelector<HTMLElement>('[role="tablist"]')!;
    const input = container.querySelector("textarea")!;
    expect(list.hidden).toBe(true);
    mocks.api.mockResolvedValueOnce({ status: "cancelled" });
    await menu("work/report.md", "save_as");
    expect(mocks.api).toHaveBeenLastCalledWith("/api/agent/workspace/activate-path", {
      path: "work/report.md",
    });
    expect(list.hidden).toBe(true);
    await menu("work/report.md");
    expect(list.hidden).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(input.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(true);
    expect(container.querySelectorAll(".agent-document textarea")).toHaveLength(0);
    await click(container.querySelector('[role="tab"]'));
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(false);
    expect(mocks.mounts).toHaveBeenCalledOnce();
    await menu("work/report.md");
    expect(container.querySelectorAll(".agent-document")).toHaveLength(1);
    await click(container.querySelector(".agent-pages__close"));
    expect(list.hidden).toBe(true);
    expect(mocks.unmounts).not.toHaveBeenCalled();
  });

  it("读取失败只 Toast，更新失败保留已打开正文", async () => {
    await render();
    mocks.api.mockRejectedValueOnce(new Error("missing"));
    await menu("work/report.md");
    expect(container.querySelector<HTMLElement>('[role="tablist"]')?.hidden).toBe(true);
    expect(container.querySelector(".agent-document")).toBeNull();
    expect(mocks.toast).toHaveBeenCalledOnce();
    await menu("work/report.md");
    await click(container.querySelector('[role="tab"]'));
    mocks.api.mockRejectedValueOnce(new Error("busy"));
    await click(tab("work/report.md"));
    expect(container.querySelector(".agent-document")?.textContent).toContain("报告正文");
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });

  it("文档配图通过会话资源接口读取，关闭页面释放 Blob", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      await render();
      mocks.api.mockResolvedValueOnce({
        sessionId: "session-1",
        path: "work/report.md",
        content: "![配图](./chart%20%23.png)",
      });
      await menu("work/report.md");
      const source = container.querySelector(".agent-document img")?.getAttribute("src");
      expect(source).toMatch(/^blob:/);
      const request = new URL(mocks.blob.mock.calls[0]![0] as string, "http://localhost");
      expect(request.searchParams.get("path")).toBe("work/chart%20%23.png");
      expect(request.searchParams.get("sessionId")).toBe("session-1");
      await click(container.querySelector(".agent-pages__close"));
      expect(revoke).toHaveBeenCalledWith(source);
    } finally {
      revoke.mockRestore();
    }
  });

  it("离开再回来按轻量记录恢复，在 StrictMode 重连时仍保留标签", async () => {
    await render();
    await menu("work/report.md");
    const viewport = container.querySelector<HTMLElement>(".agent-document")!;
    viewport.scrollTop = 80;
    await act(async () => viewport.dispatchEvent(new Event("scroll", { bubbles: true })));
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(
        <StrictMode>
          <AgentPage is_sidebar_collapsed={false} />
        </StrictMode>,
      ),
    );
    expect(container.querySelector(".agent-document")?.scrollTop).toBe(80);
    expect(tab("work/report.md")?.getAttribute("aria-selected")).toBe("true");
  });
});
