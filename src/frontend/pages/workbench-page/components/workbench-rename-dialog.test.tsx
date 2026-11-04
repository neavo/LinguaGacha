import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import type { WorkbenchFileEntry } from "@shared/workbench/workbench-query";
import { WorkbenchRenameDialog } from "./workbench-rename-dialog";

/** 文件身份决定名称冲突，进度与排序不参与改名校验。 */
function entry(rel_path: string, file_type = "TXT"): WorkbenchFileEntry {
  return {
    rel_path,
    file_type,
    sort_index: 0,
    progress: {
      unit: "line",
      total_count: 0,
      completed_count: 0,
      skipped_count: 0,
      pending_count: 0,
      completion_percent: 0,
    },
  };
}

describe("工作台改名弹窗", () => {
  let root: Root;
  let host: HTMLDivElement;
  const submit = vi.fn();
  beforeEach(() => {
    submit.mockReset();
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  /** 挂载目标文件与当前文件集合。 */
  async function render(target: WorkbenchFileEntry, others: WorkbenchFileEntry[] = []) {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <WorkbenchRenameDialog
            entry={target}
            entries={[target, ...others]}
            submitting={false}
            on_submit={submit}
            on_close={vi.fn()}
          />
        </LocaleProvider>,
      ),
    );
  }
  /** 输入主干后读取确认按钮与就地提示。 */
  async function enter(value: string) {
    const input = document.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("确认"),
    )!;
    return {
      confirm,
      issue: document.querySelector(".workbench-page__rename-issue")?.textContent ?? null,
    };
  }

  it("主干去除首尾空白，保留内部空格、目录与扩展名提交", async () => {
    await render(entry(" book/chapter.txt"));
    expect(document.querySelector("input")?.value).toBe("chapter");
    const { confirm, issue } = await enter("　 第一 章  ");
    expect(issue).toBeNull();
    expect(document.querySelector("input")?.value).toBe("　 第一 章  ");
    await act(async () => confirm.click());
    expect(submit).toHaveBeenCalledExactlyOnceWith(" book/第一 章.txt");
  });

  it.each([
    ["chapter", null],
    [" chapter ", null],
    ["", "名称不能为空"],
    ["a/b", "名称不能为空"],
    ["a?", "名称不能为空"],
    ["CON", "名称不能为空"],
    [" ", "名称不能为空"],
    ["name.", "名称不能为空"],
    ["Other", "已存在同名"],
    [" Other ", "已存在同名"],
  ])("主干 %j 禁止提交并就地提示 %j", async (stem, expected) => {
    await render(entry("chapter.txt"), [entry("other.txt")]);
    const { confirm, issue } = await enter(stem);
    expect(confirm.disabled).toBe(true);
    if (expected === null) expect(issue).toBeNull();
    else expect(issue).toContain(expected);
  });

  it.each([
    [".env", "TXT", "x.env", "名称不能为空"],
    ["game.renpy", "RENPY", "other", "已存在同名"],
    ["game.renpy", "RENPY", "name.", "名称不能为空"],
  ])("拒绝格式或输出目录无效的改名 %#", async (file, type, stem, expected) => {
    await render(entry(file, type), [entry("other/readme.txt")]);
    const { confirm, issue } = await enter(stem);
    expect(confirm.disabled).toBe(true);
    expect(issue).toContain(expected);
  });
});
