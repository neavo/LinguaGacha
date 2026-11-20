import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdownPathContext } from "./agent-file-context";
import { AgentMarkdownLink } from "./agent-markdown-link";

const mocks = vi.hoisted(() => ({
  open_external_url: vi.fn(),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => mocks);
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AgentMarkdownLink", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.open_external_url.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** 从 Portal 读取实际可执行的菜单项。 */
  async function open_menu(link: Element): Promise<HTMLElement[]> {
    await act(async () =>
      link.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true })),
    );
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  }

  it.each([
    ["//example.com/report#heading", "https://example.com/report#heading"],
    [
      "mailto:user@example.com?subject=Report%20ready",
      "mailto:user@example.com?subject=Report%20ready",
    ],
  ])("外链 %s 的默认菜单动作和复制交付实际目标", async (href, target) => {
    const write_text = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await act(async () => root.render(<AgentMarkdownLink href={href}>链接</AgentMarkdownLink>));
    const link = container.querySelector("a")!;
    const items = await open_menu(link);
    expect(items.map((item) => item.textContent)).toEqual([
      "agent_page.link.open",
      "agent_page.link.copy",
    ]);
    expect(mocks.open_external_url).not.toHaveBeenCalled();
    await act(async () => items[0]!.click());
    expect(mocks.open_external_url).toHaveBeenCalledExactlyOnceWith(target);
    const [, copy] = await open_menu(link);
    await act(async () => copy!.click());
    expect(write_text).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("文档锚点通过首项执行同一作用域内的跳转，缺失时没有菜单", async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    await act(async () =>
      root.render(
        <AgentMarkdownPathContext value="work/report.md">
          <div className="agent-markdown">
            <AgentMarkdownLink href="#title">目标</AgentMarkdownLink>
            <AgentMarkdownLink href="#missing">缺失</AgentMarkdownLink>
            <h2 id="title">标题</h2>
          </div>
        </AgentMarkdownPathContext>,
      ),
    );
    const [link, missing] = container.querySelectorAll("a");
    expect(await open_menu(missing!)).toEqual([]);
    const items = await open_menu(link!);
    expect(items.map((item) => item.textContent)).toEqual(["agent_page.link.jump_to_anchor"]);
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => items[0]!.click());
    await act(async () => link!.click());
    expect(scroll.mock.contexts).toEqual([
      container.querySelector("h2"),
      container.querySelector("h2"),
    ]);
  });
});
