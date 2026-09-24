const runtime_state = vi.hoisted(() => ({ owner: null as "agent" | null }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => runtime_state,
}));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { AppearanceContext } from "@frontend/app/appearance/appearance-context";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { SkillEditor } from "./skill-editor";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import type { AgentSkillDocument, AgentSkillIdentity } from "@shared/agent-skills";
import { create_text_resolver } from "@shared/i18n";
import { SKILL_AUTOSAVE_DELAY_MS } from "./skill-editor-document";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
const t = create_text_resolver("zh-CN");
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));

describe("技能编辑工作面", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    mocks.api.mockReset();
    runtime_state.owner = null;
    vi.useRealTimers();
  });
  /** 使用真实编辑器，文件接口由当前场景提供。 */
  async function render(source: "user" | "builtin", failure?: Error) {
    const skill: AgentSkillIdentity = { source, name: "sample" };
    let saved_document: AgentSkillDocument = {
      name: "sample",
      description: "Single line",
      body: "Body",
    };
    mocks.api.mockImplementation(
      async (url: string, body: { path?: string; document?: AgentSkillDocument }) => {
        if (url.endsWith("/save") && body.document) saved_document = body.document;
        return url.endsWith("/tree")
          ? {
              skill,
              entries: [
                { path: "SKILL.md", kind: "file" },
                { path: "reference.md", kind: "file" },
              ],
            }
          : {
              skill,
              path: body.path,
              revision: "one",
              size: 32,
              text: "Body",
              ...(body.path === "SKILL.md" ? { document: saved_document } : {}),
            };
      },
    );
    if (failure) mocks.api.mockRejectedValueOnce(failure);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
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
                <SkillEditor skill={skill} on_back={() => {}} />
              </PageLeaveProvider>
            </TooltipProvider>
          </AppearanceContext>
        </LocaleProvider>,
      ),
    );
  }
  it("初次加载展示具体错误，并能重试进入编辑器", async () => {
    await render("user", new DesktopApiError({ code: "file.not_found" }));
    expect(container.textContent).toContain(t("app.error.file.not_found.message"));
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("app.action.retry"),
    );
    await act(async () => retry!.click());
    expect(container.querySelector(".cm-content")?.textContent).toContain("name: sample");
  });

  it("顶栏整包删除等待确认，成功后清除编辑内容", async () => {
    await render("user");
    vi.useFakeTimers();
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>(".skill-editor__toolbar button"),
    ].find((button) => button.textContent === "删除")!;
    await act(async () => button.click());
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(mocks.api.mock.calls.some(([url]) => url === "/api/skills/delete")).toBe(false);
    await act(async () => vi.advanceTimersByTime(3000));
    const confirm = [...dialog.querySelectorAll("button")].find(
      (item) => item.textContent === "确认",
    )!;
    await act(async () => confirm.click());
    expect(mocks.api).toHaveBeenCalledWith("/api/skills/delete", {
      source: "user",
      name: "sample",
    });
    expect(container.querySelector(".cm-content")).toBeNull();
  });
  it("未知加载错误使用加载语境的兜底文案", async () => {
    await render("user", new Error("unavailable"));
    expect(container.textContent).toContain(t("skills_page.feedback.load_failed"));
  });
  it("用户主文件在同一编辑器展示字段和正文，普通文件直接展示文本", async () => {
    await render("user");
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(container.querySelector(".cm-content")?.textContent).toContain(
      "description: Single line",
    );
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".skill-tree__select")]
        .find((button) => button.textContent === "reference.md")!
        .click();
    });
    expect(container.querySelector(".cm-content")?.textContent).toBe("Body");
    expect(container.querySelector(".skill-editor__path")?.textContent).toContain("reference.md");
  });
  it("Agent 执行期间用户技能只读，仍可浏览包内文件", async () => {
    runtime_state.owner = "agent";
    await render("user");
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".skill-tree__select")]
        .find((button) => button.textContent === "reference.md")!
        .click();
    });
    expect(container.querySelector(".skill-editor__path")?.textContent).toContain("reference.md");
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith("/save"))).toBe(false);
  });

  it("内置技能保留选择与阅读，隐藏写入入口与状态徽标", async () => {
    await render("builtin");
    expect(container.querySelector(".cm-content")?.textContent).toContain("name: sample");
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".skill-tree__select")]
        .find((button) => button.textContent === "reference.md")!
        .click();
    });
    expect(container.querySelector(".skill-editor__path")?.textContent).toContain("reference.md");
  });

  it("自动保存保留编辑会话，放弃修改清除旧历史", async () => {
    await render("user");
    vi.useFakeTimers();
    const view = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
    const original = view.state.doc.toString();
    const from = original.indexOf("Single line");
    await act(async () =>
      view.dispatch({
        changes: { from, to: from + "Single line".length, insert: 'A: "quote" # tag' },
        userEvent: "input",
      }),
    );
    await act(async () => view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }));
    await act(async () => vi.advanceTimersByTimeAsync(SKILL_AUTOSAVE_DELAY_MS));
    expect(mocks.api.mock.calls.find(([url]) => url.endsWith("/save"))?.[1]).toMatchObject({
      document: { name: "sample", description: 'A: "quote" # tag', body: "Body" },
    });
    expect(EditorView.findFromDOM(container.querySelector(".cm-content")!)).toBe(view);
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
    await act(async () => {
      expect(undo(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe(original);
    const name_start = original.indexOf("sample");
    await act(async () =>
      view.dispatch({ changes: { from: name_start, to: name_start + "sample".length } }),
    );
    expect(view.contentDOM.getAttribute("aria-invalid")).toBe("true");
    const discard = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("skills_page.editor.discard"),
    );
    await act(async () => discard!.click());
    const restored = EditorView.findFromDOM(container.querySelector(".cm-content")!)!;
    expect(restored.state.doc.toString()).toContain('description: A: "quote" # tag');
    expect(undo(restored)).toBe(false);
  });
});
