import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@domain/app-language";
import type { ProjectSnapshot } from "@frontend/app/state/desktop-state-context";
import type { RuntimeActivitySnapshot } from "@shared/runtime-activity";
import { create_text_resolver } from "@shared/i18n";
import { LocaleContext } from "@frontend/app/locale/locale-context";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentLanguageControl } from "./agent-language-control";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  error: vi.fn(),
  toast: vi.fn(),
  progress: vi.fn(async ({ task }: { task: () => Promise<void> }) => task()),
  commit: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => run()),
  project: {
    loaded: true,
    file_count: 1,
    path: "sample.lg",
    languages: { source_language: "JA", target_language: "ZH" },
  } as ProjectSnapshot,
  runtime: { revision: 0, owner: null } as RuntimeActivitySnapshot,
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.error,
  push_toast: mocks.toast,
  run_modal_progress_toast: mocks.progress,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    project_snapshot: mocks.project,
    commit_project_write: mocks.commit,
    initial_state_status: "ready",
  }),
  useRuntimeSnapshot: () => mocks.runtime,
}));

describe("AgentLanguageControl", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.mockReset();
    mocks.project = {
      loaded: true,
      file_count: 1,
      path: "sample.lg",
      languages: { source_language: "JA", target_language: "ZH" },
    };
    mocks.runtime = { revision: 0, owner: null };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  /** 重渲染同一控件以观察界面语言和工程状态的变化。 */
  async function render(
    locale: Locale = "zh-CN",
    props: Partial<ComponentProps<typeof AgentLanguageControl>> = {},
  ): Promise<void> {
    await act(async () =>
      root.render(
        <LocaleContext value={{ locale, t: create_text_resolver(locale) }}>
          <TooltipProvider delay={0}>
            <AgentLanguageControl locked={false} disconnected={false} {...props} />
          </TooltipProvider>
        </LocaleContext>,
      ),
    );
  }
  /** 底栏入口与 Portal 内的弹窗按钮分开查询。 */
  function trigger(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>("button")!;
  }
  /** 按动作查找弹窗按钮，忽略同一按钮内的快捷键提示。 */
  function button(label: string): HTMLButtonElement {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (item) => item.textContent?.startsWith(label),
    )!;
  }
  /** 通过真实下拉交互编辑草稿。 */
  async function select(role: string, label: string): Promise<void> {
    await act(async () =>
      document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${role}"]`)!.click(),
    );
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === label,
    )!;
    await act(async () => option.click());
  }

  it("确认前只编辑草稿，取消丢弃；确认后一次提交并显示回灌语言", async () => {
    await render();
    await act(async () => trigger().click());
    await select("原文语言", "英文");
    expect(trigger().textContent).toBe("日->中");
    expect(mocks.api).not.toHaveBeenCalled();
    await act(async () => button("取消").click());
    await act(async () => trigger().click());
    expect(
      document.querySelector('[role="combobox"][aria-label="原文语言"]')?.textContent,
    ).toContain("日文");
    await select("原文语言", "英文");
    await select("译文语言", "中文（繁体）");
    mocks.api.mockImplementation(async () => {
      mocks.project.languages = { source_language: "EN", target_language: "ZH-HANT" };
      return { accepted: true, changes: [] };
    });
    await act(async () => button("确认").click());
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/project/settings/update", {
      source_language: "EN",
      target_language: "ZH-HANT",
    });
    expect(mocks.commit).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "project.settings.update" }),
    );
    expect(mocks.progress).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger().textContent).toBe("英->繁");
    await act(async () => trigger().click());
    await act(async () => button("确认").click());
    expect(mocks.api).toHaveBeenCalledOnce(); // 未修改语言时确认只关闭弹窗。
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("保存期间锁定弹窗，失败保留草稿，目标语言重试成功关闭", async () => {
    await render();
    await act(async () => trigger().click());
    await select("译文语言", "英文");
    let reject!: (error: Error) => void;
    mocks.api.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject_save) => {
          reject = reject_save;
        }),
    );
    await act(async () => button("确认").click());
    expect(button("确认").disabled).toBe(true);
    expect(button("取消").disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true);
    await act(async () => reject(new Error("save failed")));
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(
      document.querySelector('[role="combobox"][aria-label="译文语言"]')?.textContent,
    ).toContain("英文");
    expect(trigger().textContent).toBe("日->中");
    mocks.api.mockResolvedValueOnce({ accepted: true, changes: [] });
    await act(async () => button("确认").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.progress).not.toHaveBeenCalled();
  });

  it("未加载工程时隐藏入口，运行占用和断线时禁用，工程关闭后释放弹窗", async () => {
    mocks.project = { loaded: false, file_count: 0, path: "", languages: null };
    await render();
    expect(container.querySelector("button")).toBeNull();
    mocks.project = {
      loaded: true,
      file_count: 1,
      path: "sample.lg",
      languages: { source_language: "JA", target_language: "ZH" },
    };
    await render("zh-CN", { disconnected: true });
    expect(trigger().disabled).toBe(true);
    await render();
    await act(async () => trigger().click());
    mocks.runtime = { revision: 1, owner: "agent" };
    await render();
    expect(trigger().disabled).toBe(true);
    expect(button("确认").disabled).toBe(true);
    await act(async () => button("确认").click());
    expect(mocks.api).not.toHaveBeenCalled();
    await render("zh-CN", { locked: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    mocks.runtime = { revision: 2, owner: null };
    await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => trigger().click());
    mocks.project = { loaded: false, file_count: 0, path: "", languages: null };
    await render();
    expect(container.querySelector("button")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("切换界面语言后刷新简称，工程快照更新后刷新语言对", async () => {
    mocks.project.languages = { source_language: "ALL", target_language: "ZH-HANT" };
    await render();
    expect(trigger().textContent).toBe("任意->繁");
    await render("de-DE");
    expect(trigger().textContent).toBe("ALL->ZH-HANT");
    mocks.project.languages = { source_language: "JA", target_language: "EN" };
    await render("de-DE");
    expect(trigger().textContent).toBe("JA->EN");
  });
});
