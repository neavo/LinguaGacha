import { read_skill_editor_document, skill_editor_layout } from "./skill-editor-document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AppearanceContext } from "@frontend/app/appearance/appearance-context";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { PersonalityEditor } from "./personality-editor";
import { SKILL_AUTOSAVE_DELAY_MS } from "./skill-editor-document";

const mocks = vi.hoisted(() => ({ api: vi.fn(), owner: null as "agent" | null }));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => ({ owner: mocks.owner }),
}));

describe("角色设定编辑", () => {
  let root: Root;
  let container: HTMLDivElement;
  let disk: { body: string; revision: string };
  let hold: (() => Promise<void>) | undefined;
  const back = vi.fn();
  beforeEach(async () => {
    mocks.owner = null;
    mocks.api.mockReset();
    back.mockReset();
    hold = undefined;
    disk = { body: "Custom role", revision: "1" };
    mocks.api.mockImplementation(
      async (url: string, request: { body?: string | null; revision?: string }) => {
        if (url.endsWith("/save")) {
          if (request.body !== null) await hold?.();
          disk = {
            body: request.body === null ? "Default role" : request.body!,
            revision: String(Number(disk.revision) + 1),
          };
        }
        return { ...disk };
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render();
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  /** 通过真实编辑工作面验证保存与重置。 */
  async function render() {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <AppearanceContext
            value={{
              resolved_theme: "light",
              theme_preference: "light",
              font_preference: "system",
              set_theme_preference: () => {},
              set_font_preference: () => {},
            }}
          >
            <TooltipProvider>
              <PageLeaveProvider>
                <PersonalityEditor on_back={back} />
              </PageLeaveProvider>
            </TooltipProvider>
          </AppearanceContext>
        </LocaleProvider>,
      ),
    );
  }
  /** 取得当前 CodeMirror 实例，重置后不复用旧实例。 */
  function view() {
    return EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
  }
  /** 只编辑正文，保留受保护的元数据。 */
  async function edit(body: string) {
    await act(async () =>
      view().dispatch({
        changes: {
          from: skill_editor_layout(view().state.doc).body_from,
          to: view().state.doc.length,
          insert: body,
        },
        userEvent: "input",
      }),
    );
  }
  /** 从顶栏进入确认流程。 */
  async function open_reset() {
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>(".skill-editor__toolbar button")]
        .find((button) => button.textContent === "重置")!
        .click(),
    );
  }
  /** 定位倒计时结束后开放的确认动作。 */
  function confirmation() {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
      (button) => button.textContent === "确认",
    )!;
  }
  it("人格呈现固定技能文档，元数据可选择复制但不能修改", async () => {
    const document = read_skill_editor_document(view().state.doc.toString());
    const fields = skill_editor_layout(view().state.doc).fields;
    for (const field of fields) {
      await act(async () => view().dispatch({ selection: { anchor: field.from, head: field.to } }));
      expect(
        view().state.sliceDoc(view().state.selection.main.from, view().state.selection.main.to),
      ).not.toBe("");
      await act(async () =>
        view().dispatch({
          changes: { from: field.from, to: field.to, insert: "changed" },
          userEvent: "input",
        }),
      );
    }
    expect(read_skill_editor_document(view().state.doc.toString())).toEqual(document);
    await edit("Changed body");
    await act(async () => vi.advanceTimersByTime(SKILL_AUTOSAVE_DELAY_MS));
    expect(disk.body).toBe("Changed body");
  });
  it("空正文可自动保存，运行占用期间暂停写入并在空闲后恢复", async () => {
    await edit("");
    mocks.owner = "agent";
    await render();
    await act(async () => vi.advanceTimersByTime(SKILL_AUTOSAVE_DELAY_MS * 2));
    expect(disk.body).toBe("Custom role");
    expect(view().contentDOM.getAttribute("contenteditable")).toBe("false");
    mocks.owner = null;
    await render();
    await act(async () => vi.advanceTimersByTime(SKILL_AUTOSAVE_DELAY_MS));
    expect(disk.body).toBe("");
    expect(container.textContent).toContain("已保存");
  });
  it("重置复用倒计时，等待在途保存后恢复默认并清除撤销历史", async () => {
    let release!: () => void;
    hold = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    await edit("Saving role");
    await act(async () => vi.advanceTimersByTime(SKILL_AUTOSAVE_DELAY_MS));
    await edit("Discarded draft");
    await open_reset();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "是否确认重置技能 …?",
    );
    await act(async () => vi.advanceTimersByTime(3000));
    await act(async () => confirmation().click());
    expect(mocks.api.mock.calls.some(([, body]) => body.body === null)).toBe(false);
    await act(async () => release());
    expect(disk.body).toBe("Default role");
    expect(read_skill_editor_document(view().state.doc.toString()).body).toBe("Default role");
    expect(undo(view())).toBe(false);
    await act(async () => vi.advanceTimersByTime(SKILL_AUTOSAVE_DELAY_MS * 2));
    expect(mocks.api.mock.calls.filter(([url]) => url.endsWith("/save"))).toHaveLength(2);
    expect(back).not.toHaveBeenCalled();
  });
  it("确认窗口打开后出现运行占用，确认按钮仍受互斥约束", async () => {
    await open_reset();
    await act(async () => vi.advanceTimersByTime(3000));
    mocks.owner = "agent";
    await render();
    expect(confirmation().disabled).toBe(true);
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith("/save"))).toBe(false);
  });

  it("保存失败保留草稿，重试成功后更新保存状态", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Disk unavailable"));
    await edit("Unsaved role");
    await act(async () => vi.advanceTimersByTime(SKILL_AUTOSAVE_DELAY_MS));
    expect(read_skill_editor_document(view().state.doc.toString()).body).toBe("Unsaved role");
    expect(disk.body).toBe("Custom role");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "重试",
    )!;
    await act(async () => retry.click());
    expect(disk.body).toBe("Unsaved role");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("已保存");
  });
});
