import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AppearanceContext } from "@frontend/app/appearance/appearance-context";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { DOCUMENT_AUTOSAVE_DELAY_MS } from "@frontend/features/document-editor/use-autosave-document";
import type { KnowledgeFile } from "@shared/project-knowledge";
import { ProjectKnowledgeEditor } from "./page";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  commit: vi.fn(),
  toast: vi.fn(),
  navigate_to_agent: vi.fn(),
  owner: null as string | null,
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_agent: mocks.navigate_to_agent }),
}));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: mocks.toast }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    commit_project_write: mocks.commit,
  }),
  useRuntimeSnapshot: () => ({ owner: mocks.owner }),
}));

describe("工程知识编辑器", () => {
  const default_text = "# 工程知识\n";
  let root: Root;
  let host: HTMLDivElement;
  let disk: KnowledgeFile;
  const back = vi.fn();
  beforeEach(async () => {
    mocks.owner = null;
    mocks.toast.mockReset();
    mocks.api.mockReset();
    mocks.commit.mockReset();
    back.mockClear();
    disk = { text: "original", fp: "1" };
    mocks.commit.mockImplementation(async ({ run }: { run: () => Promise<unknown> }) => ({
      payload: await run(),
    }));
    mocks.api.mockImplementation(
      async (url: string, body: { text?: string | null; fp?: string }) => {
        if (url.endsWith("/read")) return { ...disk };
        if (body.fp !== disk.fp) throw new DesktopApiError({ code: "data.revision_conflict" });
        if (url.endsWith("/save")) {
          disk = { text: body.text ?? default_text, fp: String(Number(disk.fp) + 1) };
          return { accepted: true, changes: [], document: { ...disk } };
        }
        throw new Error(url);
      },
    );
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await render();
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });
  /** 挂载真实知识工作面，观察查询与编辑的跨层行为。 */
  async function render() {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <AppearanceContext
            value={{
              resolved_theme: "light",
              theme_preference: "light",
              font_preference: "system",
              font_size_preference: "normal",
              set_font_size_preference: () => {},
              set_theme_preference: () => {},
              set_font_preference: () => {},
            }}
          >
            <TooltipProvider>
              <PageLeaveProvider>
                <ProjectKnowledgeEditor on_back={back} />
              </PageLeaveProvider>
            </TooltipProvider>
          </AppearanceContext>
        </LocaleProvider>,
      ),
    );
  }
  /** 用可见动作或无障碍名称选择控件。 */
  async function click(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) =>
        button.getAttribute("aria-label")?.startsWith(label) ||
        button.textContent?.trim().startsWith(label),
    )!;
    expect(button, label).toBeDefined();
    await act(async () => button.click());
  }
  /** 重新取得当前编辑器，避免放弃草稿后复用旧实例。 */
  function view() {
    return EditorView.findFromDOM(host.querySelector(".cm-content")!)!;
  }
  /** 通过编辑器事务模拟正文输入。 */
  async function edit(text: string) {
    await act(async () =>
      view().dispatch({
        changes: { from: 0, to: view().state.doc.length, insert: text },
        userEvent: "input",
      }),
    );
  }
  /** 推进自动保存时钟，等待异步请求完成。 */
  async function save() {
    await act(async () => vi.advanceTimersByTimeAsync(DOCUMENT_AUTOSAVE_DELAY_MS));
  }

  /** 在确认窗内定位提交动作。 */
  function confirmation() {
    const dialog = document.querySelector('[role="alertdialog"]')!;
    return [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.startsWith("确认"),
    )!;
  }

  it("自动保存贯通统一写入入口，成功后可返回", async () => {
    expect(view().state.doc.toString()).toBe("original");
    await edit("new note");
    await save();
    expect(disk.text).toBe("new note");
    expect(mocks.api).toHaveBeenCalledWith("/api/project/knowledge/save", {
      fp: "1",
      text: "new note",
    });
    expect(mocks.commit).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "knowledge.save" }),
    );
    await click("返回");
    expect(back).toHaveBeenCalledOnce();
  });

  it("冲突保留草稿，放弃读取最新正文，覆盖先取最新指纹", async () => {
    disk = { text: "external", fp: "2" };
    await edit("draft");
    await save();
    expect(view().state.doc.toString()).toBe("draft");
    expect(host.textContent).toContain("覆盖");
    await click("放弃修改");
    expect(view().state.doc.toString()).toBe("external");
    disk = { text: "external again", fp: "3" };
    await edit("chosen");
    await save();
    await click("覆盖");
    expect(disk).toEqual({ text: "chosen", fp: "4" });
    expect(mocks.api).toHaveBeenCalledWith("/api/project/knowledge/save", {
      fp: "3",
      text: "chosen",
    });
  });

  it("运行占用时编辑器只读、重置不可提交，解除后 Ctrl+S 可立即保存", async () => {
    await click("重置");
    mocks.owner = "batch_translation";
    await render();
    expect(host.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
    expect(confirmation().disabled).toBe(true);
    await act(async () => confirmation().click());
    expect(mocks.commit).not.toHaveBeenCalled();
    await click("取消");
    mocks.owner = null;
    await render();
    await edit("saved now");
    await act(async () =>
      host
        .querySelector(".document-editor")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })),
    );
    expect(disk.text).toBe("saved now");
  });

  it("重置接管在途保存，以最新指纹恢复默认正文并清除撤销历史", async () => {
    const save_url = "/api/project/knowledge/save";
    const hold = Promise.withResolvers<void>();
    const respond = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementationOnce(async (url, body) => {
      expect(url).toBe(save_url);
      await hold.promise;
      return respond(url, body);
    });
    await edit("正在保存");
    await save();
    await edit("待放弃草稿");
    await click("重置");
    await act(async () => confirmation().click());
    expect(mocks.api.mock.calls.filter(([url]) => url === save_url)).toEqual([
      [save_url, { fp: "1", text: "正在保存" }],
    ]);
    await act(async () => hold.resolve());

    expect(mocks.api.mock.calls.filter(([url]) => url === save_url)).toEqual([
      [save_url, { fp: "1", text: "正在保存" }],
      [save_url, { fp: "2", text: null }],
    ]);
    expect(view().state.doc.toString()).toBe(default_text);
    expect(undo(view())).toBe(false);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
