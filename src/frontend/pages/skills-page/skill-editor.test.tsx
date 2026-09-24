import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { AppearanceContext } from "@frontend/app/appearance/appearance-context";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { SkillEditor } from "./skill-editor";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import type { AgentSkillIdentity } from "@shared/agent-skills";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@frontend/app/desktop/desktop-api", async (original) => ({
  ...(await original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: vi.fn() }));

describe("技能编辑工作面", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    mocks.api.mockReset();
  });
  /** 使用真实表单与编辑器，文件接口由当前场景提供。 */
  async function render(source: "user" | "builtin", failure?: Error) {
    const skill: AgentSkillIdentity = { source, name: "sample" };
    mocks.api.mockImplementation(async (url: string, body: { path?: string }) =>
      url.endsWith("/tree")
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
            ...(body.path === "SKILL.md"
              ? { document: { name: "sample", description: "Single line", body: "Body" } }
              : {}),
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
    expect(container.textContent).toContain("文件不存在");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "重试",
    );
    await act(async () => retry!.click());
    expect(container.querySelector(".skill-editor__metadata")).not.toBeNull();
  });
  it("未知加载错误使用加载语境的兜底文案", async () => {
    await render("user", new Error("unavailable"));
    expect(container.textContent).toContain("技能加载失败");
    expect(container.textContent).not.toContain("保存失败");
  });
  it("用户主文件使用单行表单，普通文件切换为完整编辑器", async () => {
    await render("user");
    const inputs = container.querySelectorAll<HTMLInputElement>(".skill-editor__metadata input");
    expect(inputs[1].readOnly).toBe(false);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
    await act(async () => {
      (container.querySelector('button[title="reference.md"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector(".skill-editor__metadata")).toBeNull();
    expect(container.querySelector(".skill-editor__path")?.textContent).toContain("reference.md");
  });
  it("内置技能保留选择与阅读，隐藏写入入口与状态徽标", async () => {
    await render("builtin");
    expect(
      [...container.querySelectorAll<HTMLInputElement>(".skill-editor__metadata input")].every(
        (input) => input.readOnly && !input.disabled,
      ),
    ).toBe(true);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
    await act(async () => {
      (container.querySelector('button[title="reference.md"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector(".skill-editor__path")?.textContent).toContain("reference.md");
  });
});
