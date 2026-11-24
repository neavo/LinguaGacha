import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { DOCUMENT_AUTOSAVE_DELAY_MS, useAutosaveDocument } from "./use-autosave-document";

const feedback = vi.hoisted(() => ({ toast: vi.fn(), t: (key: string) => key }));
vi.mock("@frontend/app/locale/locale-context", () => ({ useI18n: () => ({ t: feedback.t }) }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: feedback.toast }));

let root: Root;
let host: HTMLDivElement;
let editor: ReturnType<typeof useAutosaveDocument<{ text: string; fp: number }>>;
let locked: boolean;
const save =
  vi.fn<
    (file: { text: string; fp: number }, draft: string) => Promise<{ text: string; fp: number }>
  >();
/** 通过公开编辑入口观察保存状态与请求顺序。 */
function Harness() {
  editor = useAutosaveDocument<{ text: string; fp: number }>({
    initial: {
      file: { text: "original", fp: 1 },
      draft: "original",
      loading: false,
    },
    locked,
    read_text: (file) => file.text,
    save,
  });
  return null;
}
beforeEach(async () => {
  vi.useFakeTimers();
  locked = false;
  feedback.toast.mockReset();
  save.mockReset().mockImplementation(async (file, text) => ({ text, fp: file.fp + 1 }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("合并输入，组词和运行占用暂停，空闲后保存最新正文", async () => {
  await act(async () => {
    editor.edit("first");
    editor.edit("latest");
    editor.compose(true);
  });
  await act(async () => vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS * 2));
  expect(save).not.toHaveBeenCalled();
  locked = true;
  await act(async () => {
    editor.compose(false);
    root.render(<Harness />);
  });
  await act(async () => vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS * 2));
  expect(save).not.toHaveBeenCalled();
  locked = false;
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS));
  expect(save).toHaveBeenCalledExactlyOnceWith({ text: "original", fp: 1 }, "latest");
  expect(editor.dirty).toBe(false);
});

it("保存中继续输入与撤销仍串行追上草稿，离页等待同一保存", async () => {
  let resolve!: (value: { text: string; fp: number }) => void;
  save.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => editor.edit("first"));
  await act(async () => vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS));
  let leave!: Promise<boolean>;
  await act(async () => {
    editor.edit("original");
    leave = editor.flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve({ text: "first", fp: 2 });
    expect(await leave).toBe(true);
  });
  expect(save.mock.calls.map(([file, draft]) => [file.fp, draft])).toEqual([
    [1, "first"],
    [2, "original"],
  ]);
  expect(editor.state.file).toEqual({ text: "original", fp: 3 });
  expect(editor.dirty).toBe(false);
});

it("失败保留草稿并暂停自动重试，新输入或显式保存恢复，冲突单独标记", async () => {
  save.mockRejectedValueOnce(new DesktopApiError({ code: "data.revision_conflict" }));
  await act(async () => editor.edit("unsaved"));
  await act(async () => {
    expect(await editor.flush()).toBe(false);
  });
  expect(editor.state).toMatchObject({
    draft: "unsaved",
    save_failure: "conflict",
    file: { text: "original" },
  });
  await act(async () => vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS * 3));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => editor.edit("retry"));
  await act(async () => vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS));
  expect(editor.state).toMatchObject({
    draft: "retry",
    save_failure: null,
    file: { text: "retry" },
  });
});
