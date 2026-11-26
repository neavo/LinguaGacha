import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { create_text_resolver } from "@shared/i18n";
import { WorkbenchRenameDialog } from "./workbench-rename-dialog";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: toast }));

const t = create_text_resolver("zh-CN");

describe("工作台改名弹窗", () => {
  let root: Root;
  let host: HTMLDivElement;
  const submit = vi.fn();
  const close = vi.fn();
  beforeEach(() => {
    submit.mockReset();
    close.mockReset();
    toast.mockReset();
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  /** 挂载指定路径的改名弹窗。 */
  async function render(rel_path: string) {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <WorkbenchRenameDialog
            rel_path={rel_path}
            submitting={false}
            on_submit={submit}
            on_close={close}
          />
        </LocaleProvider>,
      ),
    );
  }
  /** 输入主干，再像用户一样点击确认。 */
  async function confirm_name(value: string) {
    const input = document.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith(t("app.action.confirm")),
    )!;
    await act(async () => confirm.click());
  }

  it("主干去除首尾空白，保留内部空格、目录与扩展名提交", async () => {
    await render(" book/chapter.txt");
    expect(document.querySelector("input")?.value).toBe("chapter");
    await confirm_name("　 第一 章  ");
    expect(submit).toHaveBeenCalledExactlyOnceWith(" book/第一 章.txt");
  });

  it("名称未变时直接关闭", async () => {
    await render("chapter.txt");
    await confirm_name(" chapter ");
    expect(close).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it.each([
    [".env", "x.env"],
    ["game.renpy", "name."],
  ])("提交时拒绝改变扩展名或产生非法主干 %s → %s", async (file, stem) => {
    await render(file);
    await confirm_name(stem);
    expect(toast).toHaveBeenCalledWith("warning", t("app.feedback.invalid_file_name"));
    expect(submit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector("input")?.value).toBe(stem);
  });
});
