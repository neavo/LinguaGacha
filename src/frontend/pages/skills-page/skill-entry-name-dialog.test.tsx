import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { SkillEntryNameDialog } from "./skill-entry-name-dialog";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: toast }));

describe("技能名称弹窗", () => {
  let root: Root;
  let host: HTMLDivElement;
  const submit = vi.fn();
  const close = vi.fn();
  beforeEach(() => {
    submit.mockReset().mockResolvedValue(true);
    close.mockReset();
    toast.mockReset();
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  /** 挂载指定命名操作，观察提交结果与关闭时机。 */
  async function render(operation: "create_file" | "create_directory" | "rename" = "create_file") {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <SkillEntryNameDialog
            operation={operation}
            initial_name=""
            busy={false}
            readonly={false}
            on_submit={submit}
            on_close={close}
          />
        </LocaleProvider>,
      ),
    );
  }
  /** 从输入事件提交名称，组词标记模拟输入法确认。 */
  async function enter(value: string, composing = false) {
    const input = document.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: composing,
        }),
      ),
    );
  }
  it.each([
    ["create_file", "说明", "说明.md"],
    ["create_file", "script.py", "script.py"],
    ["create_file", ".env", ".env"],
    ["create_directory", "references", "references"],
    ["rename", "README", "README"],
  ] as const)("%s 提交 %s 得到 %s", async (operation, name, expected) => {
    await render(operation);
    await enter(name);
    expect(submit).toHaveBeenCalledExactlyOnceWith(expected);
    expect(close).toHaveBeenCalledOnce();
  });
  it("失败保留输入，组词与非法名称不提交，取消关闭", async () => {
    await render();
    await enter("说明", true);
    expect(submit).not.toHaveBeenCalled();
    await enter("说明.");
    expect(submit).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledOnce();
    submit.mockResolvedValueOnce(false);
    await enter("说明");
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector("input")?.value).toBe("说明");
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "取消")!
        .click(),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
