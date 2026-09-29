import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdownLink } from "./agent-markdown-link";

const mocks = vi.hoisted(() => ({
  open_external_url: vi.fn(),
  api_fetch: vi.fn(),
  push_toast: vi.fn(),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => mocks);
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: mocks.push_toast }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AgentMarkdownLink", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.api_fetch.mockReset();
    mocks.api_fetch.mockResolvedValue({ status: "opened" });
    mocks.open_external_url.mockClear();
    mocks.push_toast.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  /** 每个 href 由真实链接组件处理，观察公开 API 与错误反馈。 */
  async function render_links(paths: string[]): Promise<HTMLDivElement> {
    await act(async () =>
      root.render(
        <>
          {paths.map((href) => (
            <AgentMarkdownLink key={href} href={href}>
              文件
            </AgentMarkdownLink>
          ))}
        </>,
      ),
    );
    return container;
  }
  it("工作区链接把编码路径交给工作区 API，失败只提示一次", async () => {
    const view = await render_links(["work/报告%20%23%25.md", "work/reports/"]);
    const links = view.querySelectorAll<HTMLAnchorElement>("a");
    await act(async () => links[0]?.click());
    expect(mocks.api_fetch).toHaveBeenCalledWith("/api/agent/workspace/activate-path", {
      path: "work/%E6%8A%A5%E5%91%8A%20%23%25.md",
    });
    mocks.api_fetch.mockRejectedValueOnce(new Error("missing"));
    await act(async () => links[1]?.click());
    expect(mocks.api_fetch).toHaveBeenLastCalledWith("/api/agent/workspace/activate-path", {
      path: "work/reports/",
    });
    expect(mocks.open_external_url).not.toHaveBeenCalled();
    expect(mocks.push_toast).toHaveBeenCalledOnce();
  });

  it("待决链接只提交一次，保存通知后可再次点击并安静取消", async () => {
    const view = await render_links(["work/report.md"]);
    let finish!: (value: { status: string }) => void;
    mocks.api_fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const link = view.querySelector("a");
    await act(async () => {
      link?.click();
      link?.click();
    });
    expect(mocks.api_fetch).toHaveBeenCalledOnce();
    expect(mocks.push_toast).not.toHaveBeenCalled();
    await act(async () => finish({ status: "saved" }));
    expect(mocks.push_toast).toHaveBeenCalledExactlyOnceWith("success", "agent_page.file_saved");
    mocks.api_fetch.mockResolvedValueOnce({ status: "cancelled" });
    await act(async () => link?.click());
    expect(mocks.api_fetch).toHaveBeenCalledTimes(2);
    expect(mocks.push_toast).toHaveBeenCalledOnce();
  });
});
