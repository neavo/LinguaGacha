import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { SkillFileTree } from "./skill-file-tree";

describe("技能文件树", () => {
  let host: HTMLDivElement;
  let root: Root;
  const change = vi.fn();
  const open = vi.fn();
  beforeEach(() => {
    change.mockReset().mockResolvedValue(true);
    open.mockReset().mockResolvedValue(true);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  /** 用真实菜单与表单观察文件操作意图，磁盘结果由文件服务测试负责。 */
  async function render(readonly = false) {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <SkillFileTree
              entries={[
                { path: "SKILL.md", kind: "file" },
                { path: "note.md", kind: "file" },
                { path: "references", kind: "directory" },
              ]}
              path="SKILL.md"
              readonly={readonly}
              busy={false}
              on_change={change}
              on_open={open}
            />
          </TooltipProvider>
        </LocaleProvider>,
      ),
    );
  }

  /** 输入事件经过 React，覆盖表单状态与提交之间的关联。 */
  async function enter_name(value: string) {
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** 通过文件行菜单选择操作，保持菜单与条目的绑定可观察。 */
  async function menu_action(label: string) {
    const row = host.querySelector('button[title="note.md"]')!.parentElement!;
    await act(async () =>
      (row.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement).click(),
    );
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (node) => node.textContent === label,
    )!;
    await act(async () => item.click());
  }

  it("在选中目录新建文件，失败保留输入，成功后结束编辑", async () => {
    await render();
    await act(async () =>
      (host.querySelector('button[title="references"]') as HTMLButtonElement).click(),
    );
    await act(async () =>
      (host.querySelector('button[aria-label="新增文件"]') as HTMLButtonElement).click(),
    );
    await enter_name("guide.md");
    change.mockResolvedValueOnce(false);
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(change).toHaveBeenLastCalledWith({
      operation: "create_file",
      path: "references/guide.md",
    });
    expect(host.querySelector("input")?.value).toBe("guide.md");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(host.querySelector("input")).toBeNull();
  });

  it("改名提交目标路径，删除等待确认，内置树保留文件选择", async () => {
    await render();
    await menu_action("改名");
    await enter_name("renamed.md");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(change).toHaveBeenLastCalledWith({
      operation: "move",
      path: "note.md",
      destination: "renamed.md",
    });
    change.mockClear();
    await menu_action("删除");
    expect(change).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    await act(async () =>
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent === "删除")!
        .click(),
    );
    expect(change).toHaveBeenCalledExactlyOnceWith({ operation: "delete", path: "note.md" });
    await render(true);
    expect(host.querySelector('[aria-label="新增文件"]')).toBeNull();
    expect(host.querySelector('[aria-haspopup="menu"]')).toBeNull();
    await act(async () =>
      (host.querySelector('button[title="note.md"]') as HTMLButtonElement).click(),
    );
    expect(open).toHaveBeenCalledExactlyOnceWith("note.md");
  });
});
