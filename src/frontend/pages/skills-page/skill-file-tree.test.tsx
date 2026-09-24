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

  /** 用真实按钮与表单观察文件操作意图，磁盘结果由文件服务测试负责。 */
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
                { path: "references/nested", kind: "directory" },
                { path: "references/guide.md", kind: "file" },
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
    const input = document.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** 通过名称找到主体按钮，操作按钮独立于打开文件的入口。 */
  function entry_button(name: string): HTMLButtonElement {
    return [...host.querySelectorAll<HTMLButtonElement>(".skill-tree__select")].find(
      (button) => button.textContent === name,
    )!;
  }
  /** 点击条目的直接操作按钮。 */
  async function row_action(label: string) {
    const row = entry_button("note.md").parentElement!;
    await act(async () =>
      row.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
    );
  }

  it("新增文件提交选中目录下的相对路径", async () => {
    await render();
    await act(async () => entry_button("references").click());
    await act(async () =>
      (host.querySelector('button[aria-label="新增文件"]') as HTMLButtonElement).click(),
    );
    await enter_name("guide.md");
    await act(async () =>
      document
        .querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
    );
    expect(change).toHaveBeenLastCalledWith({
      operation: "create_file",
      path: "references/guide.md",
    });
    expect(document.querySelector("input")).toBeNull();
  });

  it("改名提交目标路径，删除等待确认，内置树保留文件选择", async () => {
    await render();
    await row_action("改名");
    await enter_name("renamed.md");
    await act(async () =>
      document
        .querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
    );
    expect(change).toHaveBeenLastCalledWith({
      operation: "move",
      path: "note.md",
      destination: "renamed.md",
    });
    change.mockClear();
    await row_action("删除");
    expect(change).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    await act(async () =>
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent === "删除")!
        .click(),
    );
    expect(change).toHaveBeenCalledExactlyOnceWith({ operation: "delete", path: "note.md" });
    expect(open).not.toHaveBeenCalled();
    await render(true);
    expect(host.querySelector('[aria-label="新增文件"]')).toBeNull();
    expect(host.querySelector('[aria-label="改名"]')).toBeNull();
    await act(async () => entry_button("note.md").click());
    expect(open).toHaveBeenCalledExactlyOnceWith("note.md");
  });
  /** 模拟原生拖拽载荷，观察目录命令与无效落点。 */
  async function drag(source: string, target: string) {
    const from = entry_button(source.split("/").at(-1)!);
    const to = target
      ? entry_button(target.split("/").at(-1)!).parentElement!
      : entry_button("/").parentElement!;
    const transfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    for (const [node, type] of [
      [from, "dragstart"],
      [to, "dragover"],
      [to, "drop"],
      [from, "dragend"],
    ] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: transfer });
      await act(async () => node.dispatchEvent(event));
    }
  }
  it("拖入目录、拖回根目录与失败重试使用相同移动命令", async () => {
    await render();
    change.mockResolvedValueOnce(false);
    await drag("note.md", "references");
    expect(change).toHaveBeenLastCalledWith({
      operation: "move",
      path: "note.md",
      destination: "references/note.md",
    });
    await drag("note.md", "references");
    expect(change).toHaveBeenCalledTimes(2);
    change.mockClear();
    await drag("references/guide.md", "");
    expect(change).toHaveBeenCalledExactlyOnceWith({
      operation: "move",
      path: "references/guide.md",
      destination: "guide.md",
    });
    change.mockClear();
    await drag("references", "references/nested");
    await drag("note.md", "");
    await drag("references", "references");
    await drag("SKILL.md", "references");
    expect(change).not.toHaveBeenCalled();
  });
  it("文件树剪切粘贴移动与拖拽共用目标规则", async () => {
    await render();
    const source = entry_button("note.md");
    await act(async () => source.focus());
    await act(async () =>
      source.dispatchEvent(
        new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true }),
      ),
    );
    expect(source.parentElement?.dataset.cut).toBe("true");
    const target = entry_button("references");
    await act(async () => target.focus());
    await act(async () =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }),
      ),
    );
    expect(change).toHaveBeenCalledExactlyOnceWith({
      operation: "move",
      path: "note.md",
      destination: "references/note.md",
    });
    expect(source.parentElement?.dataset.cut).toBeUndefined();
  });
  it("根目录行接收键盘移动并决定新增位置", async () => {
    await render();
    await act(async () => entry_button("references").click());
    const source = entry_button("guide.md");
    await act(async () => source.focus());
    await act(async () =>
      source.dispatchEvent(
        new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true }),
      ),
    );
    const root_entry = entry_button("/");
    await act(async () => root_entry.focus());
    await act(async () =>
      root_entry.dispatchEvent(
        new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }),
      ),
    );
    expect(change).toHaveBeenLastCalledWith({
      operation: "move",
      path: "references/guide.md",
      destination: "guide.md",
    });
    await act(async () => root_entry.click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="新增文件"]')!.click(),
    );
    await enter_name("root-note");
    await act(async () =>
      document
        .querySelector("input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(change).toHaveBeenLastCalledWith({ operation: "create_file", path: "root-note.md" });
    expect(root_entry.parentElement?.querySelector('[aria-label="删除"]')).toBeNull();
  });
});
