import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AgentFileContext } from "./agent-file-context";
import { AgentMarkdownLink } from "./agent-markdown-link";

const mocks = vi.hoisted(() => ({
  open_file: vi.fn(),
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
    mocks.api_fetch.mockImplementation(async (_route, body) => ({
      path: body.path,
      name: "报告",
      kind: "file",
      preview: "markdown",
    }));
    mocks.open_file.mockClear();
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
        <AgentFileContext
          value={{ open_file: mocks.open_file, session_id: "session", active: true }}
        >
          {paths.map((href) => (
            <AgentMarkdownLink key={href} href={href}>
              文件
            </AgentMarkdownLink>
          ))}
        </AgentFileContext>,
      ),
    );
    return container;
  }
  it("相对链接归一编码后交给文件入口，外链交给宿主", async () => {
    const view = await render_links(["work/报告%20%23%25.md", "https://example.com"]);
    const links = view.querySelectorAll<HTMLAnchorElement>("a");
    await act(async () => links[0]!.click());
    expect(mocks.open_file).toHaveBeenCalledWith(
      "work/%E6%8A%A5%E5%91%8A%20%23%25.md",
      expect.objectContaining({ preview: "markdown" }),
    );
    await act(async () => links[1]!.click());
    expect(mocks.open_external_url).toHaveBeenCalledWith("https://example.com");
  });
});
