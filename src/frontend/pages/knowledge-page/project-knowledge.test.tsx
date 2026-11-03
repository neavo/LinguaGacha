import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AppearanceContext } from "@frontend/app/appearance/appearance-context";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { DOCUMENT_AUTOSAVE_DELAY_MS } from "./use-autosave-document";
import type { KnowledgeFile } from "@shared/project-knowledge";
import { KnowledgePage } from "./page";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  commit: vi.fn(),
  toast: vi.fn(),
  owner: null as string | null,
  seq: 0,
  settings: {},
}));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_agent: vi.fn() }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: mocks.toast }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    settings_snapshot: mocks.settings,
    commit_project_write: mocks.commit,
  }),
  useRuntimeSnapshot: () => ({ owner: mocks.owner }),
  useProjectChangeSignal: () => ({
    seq: mocks.seq,
    reason: "test",
    updated_sections: ["knowledge"],
    results: [],
  }),
}));

describe("知识页面的工程知识分组", () => {
  let root: Root;
  let host: HTMLDivElement;
  let disk: Map<string, KnowledgeFile>;
  beforeEach(async () => {
    mocks.owner = null;
    mocks.seq = 0;
    mocks.toast.mockReset();
    mocks.api.mockReset();
    mocks.commit.mockReset();
    disk = new Map(["b.md", "a.md"].map((path) => [path, { path, text: "original", fp: "1" }]));
    mocks.commit.mockImplementation(async ({ run }: { run: () => Promise<unknown> }) => ({
      payload: await run(),
    }));
    mocks.api.mockImplementation(
      async (url: string, body: { path?: string; text?: string; fp?: string }) => {
        if (url === "/api/skills/snapshot") return { skills: [] };
        if (url.endsWith("/list")) return [...disk.values()].map(({ path, fp }) => ({ path, fp }));
        const file = disk.get(body.path!);
        if (url.endsWith("/read")) {
          if (!file) throw new DesktopApiError({ code: "file.not_found" });
          return { ...file };
        }
        if (body.fp !== undefined && body.fp !== file?.fp)
          throw new DesktopApiError({ code: "data.revision_conflict" });
        if (url.endsWith("/save")) {
          const document = {
            path: body.path!,
            text: body.text!,
            fp: String(Number(file?.fp ?? 0) + 1),
          };
          disk.set(document.path, document);
          return { accepted: true, changes: [], document };
        }
        if (url.endsWith("/delete")) {
          disk.delete(body.path!);
          return { accepted: true, changes: [] };
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
                <KnowledgePage />
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

  it("排序、分区刷新和自动保存贯通统一写入入口，重读失败保留列表，确实为空才显示空态", async () => {
    const group = host.querySelector('section[aria-label="工程知识"]')!;
    const headings = () =>
      [...group.querySelectorAll(".document-list__heading")].map((node) => node.textContent);
    expect(headings()).toEqual(["a.md", "b.md"]);
    disk.set("notes/world.md", { path: "notes/world.md", text: "new", fp: "1" });
    mocks.seq += 1;
    await render();
    expect(headings()).toEqual(["a.md", "b.md", "notes/world.md"]);
    await click("notes/world.md");
    const list_reads = () => mocks.api.mock.calls.filter(([url]) => url.endsWith("/list")).length;
    const before = list_reads();
    mocks.seq += 1;
    await render();
    expect(list_reads()).toBe(before);
    await edit("---\ndescription: 世界设定\n---\nnew note");
    await save();
    expect(disk.get("notes/world.md")?.text).toContain("new note");
    expect(mocks.commit).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "knowledge.save" }),
    );
    await click("返回");
    expect(host.querySelector<HTMLElement>(".knowledge-page__list")?.hidden).toBe(false);
    expect(group.querySelector(".document-list__empty")).toBeNull();
    mocks.api.mockRejectedValueOnce(new Error("offline"));
    mocks.seq += 1;
    await render();
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(headings()).toEqual(["a.md", "b.md", "notes/world.md"]);
    disk.clear();
    mocks.seq += 1;
    await render();
    expect(group.querySelector(".document-list__rows")).toBeNull();
    expect(group.querySelector(".document-list__empty")).not.toBeNull();
  });

  it("冲突保留草稿，放弃读取最新正文，覆盖先取最新指纹", async () => {
    await click("a.md");
    disk.set("a.md", { path: "a.md", text: "external", fp: "2" });
    await edit("draft");
    await save();
    expect(view().state.doc.toString()).toBe("draft");
    expect(host.textContent).toContain("覆盖");
    await click("放弃修改");
    expect(view().state.doc.toString()).toBe("external");
    disk.set("a.md", { path: "a.md", text: "external again", fp: "3" });
    await edit("chosen");
    await save();
    await click("覆盖");
    expect(disk.get("a.md")).toMatchObject({ text: "chosen", fp: "4" });
    expect(mocks.api).toHaveBeenCalledWith("/api/project/knowledge/save", {
      path: "a.md",
      fp: "3",
      text: "chosen",
    });
  });

  it("运行占用只读，Ctrl+S 立即保存，删除需要确认", async () => {
    await click("a.md");
    mocks.owner = "batch_translation";
    await render();
    expect(host.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="删除"]')?.disabled).toBe(true);
    mocks.owner = null;
    await render();
    await edit("saved now");
    await act(async () =>
      host
        .querySelector(".document-editor")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })),
    );
    expect(disk.get("a.md")?.text).toBe("saved now");
    await click("删除");
    expect(disk.has("a.md")).toBe(true);
    await click("取消");
    expect(disk.has("a.md")).toBe(true);
    await click("删除");
    await click("确认");
    expect(disk.has("a.md")).toBe(false);
    expect(mocks.commit).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "knowledge.delete" }),
    );
  });
});
