import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentSkillEntry, AgentSkillIdentity } from "@shared/agent-skills";
import { KnowledgePage } from "./page";
import { zh_cn_knowledge_page } from "@shared/i18n/resources/zh-CN/knowledge-page";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate_to_agent: vi.fn(),
  toast: vi.fn(),
  settings: {},
  owner: null as "agent" | null,
}));
vi.mock("@frontend/app/navigation/navigation-context", () => ({
  useAppNavigation: () => ({ navigate_to_agent: mocks.navigate_to_agent }),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.toast,
  push_toast: mocks.toast,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => ({ owner: mocks.owner }),
  useDesktopState: () => ({ settings_snapshot: mocks.settings }),
}));
vi.mock("./project-knowledge", () => ({ ProjectKnowledgeEditor: () => null }));
vi.mock("./skill-editor", () => ({
  SkillEditor: ({ skill, on_back }: { skill: AgentSkillIdentity; on_back: () => void }) => (
    <button onClick={on_back}>
      {skill.source}/{skill.name}
    </button>
  ),
}));

/** 使用测试自有技能覆盖同名来源，避免依赖动态内置资源。 */
function skill(name: string, source: "builtin" | "user"): AgentSkillEntry {
  return {
    name,
    source,
    enabled: true,
    displayDescriptions: {
      "zh-CN": "描述",
      "en-US": "Description",
      "de-DE": "Beschreibung",
      "ja-JP": "説明",
      "ko-KR": "설명",
    },
  };
}

describe("知识页面的技能分组", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.navigate_to_agent.mockReset();
    mocks.owner = null;
    mocks.toast.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** 通过实际页面触发查询与保存，保留组件到接口的绑定。 */
  async function render() {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <KnowledgePage />
          </TooltipProvider>
        </LocaleProvider>,
      ),
    );
  }

  it("读取中不显示空态，读取完成且无用户技能时才显示", async () => {
    let resolve!: (snapshot: { skills: AgentSkillEntry[] }) => void;
    mocks.api.mockImplementation(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    await render();
    expect(container.querySelector('.knowledge-page[aria-busy="true"]')).not.toBeNull();
    const personality = container.querySelector<HTMLButtonElement>(
      '.document-list__open[aria-label="personality"]',
    )!;
    expect(personality.disabled).toBe(true);
    expect(container.querySelector(".document-list__empty")).toBeNull();
    await act(async () => resolve({ skills: [] }));
    expect(container.querySelector(".document-list__empty")).not.toBeNull();
    expect(container.querySelector('.document-list__open[aria-label="personality"]')).toBe(
      personality,
    );
    expect(personality.disabled).toBe(false);
  });

  it.each(["install", "knowledge_create"] as const)(
    "%s 指南可取消，前往 Agent 时携带完整请求和占位选区",
    async (guide) => {
      mocks.api.mockResolvedValue({ skills: [] });
      await render();
      const help = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${zh_cn_knowledge_page[guide].title}"]`,
      )!;
      await act(async () => help.click());
      const dialog = document.querySelector('[role="alertdialog"]')!;
      expect(dialog.querySelector('[data-slot="alert-dialog-title"]')?.textContent).toBe("确认");
      expect(dialog.querySelector('[data-slot="alert-dialog-description"]')?.textContent).toBe(
        zh_cn_knowledge_page[guide].description,
      );
      /** 通过弹窗中的可见动作文字查找按钮。 */
      const action = (text: string) =>
        [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
          (button) => button.textContent?.startsWith(text),
        )!;
      await act(async () => action("取消").click());
      expect(mocks.navigate_to_agent).not.toHaveBeenCalled();
      await act(async () => help.click());
      await act(async () => action("由 AGENT 处理").click());
      const request = mocks.navigate_to_agent.mock.calls[0]![0];
      expect(request.text).toBe(
        zh_cn_knowledge_page[guide].request.replace(
          "{PLACEHOLDER}",
          zh_cn_knowledge_page[guide].placeholder,
        ),
      );
      expect(request.text.slice(request.selection.from, request.selection.to)).toBe(
        zh_cn_knowledge_page[guide].placeholder,
      );
    },
  );

  it("Agent 占用时禁用开关和拖拽但保留详情入口", async () => {
    mocks.owner = "agent";
    mocks.api.mockResolvedValue({ skills: [skill("sample", "user")] });
    await render();
    const entry = container.querySelector<HTMLButtonElement>(
      '.document-list__open[aria-label="sample"]',
    )!;
    expect(
      entry
        .closest(".document-list__row")
        ?.querySelector<HTMLButtonElement>(".document-list__handle")?.disabled,
    ).toBe(true);
    expect(entry.disabled).toBe(false);
    for (const button of container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"))
      expect(button.disabled).toBe(true);
  });

  it.each(["builtin", "user"] as const)(
    "%s 技能条目进入对应详情，把手点击不导航",
    async (source) => {
      mocks.api.mockResolvedValue({ skills: [skill("sample", source)] });
      await render();
      const list = container.querySelector<HTMLElement>(".knowledge-page__list")!;
      const entry = container.querySelector<HTMLButtonElement>(
        'button.document-list__open[aria-label="sample"]',
      )!;
      const handle = entry
        .closest(".document-list__row")!
        .querySelector<HTMLButtonElement>(".document-list__handle")!;
      await act(async () => handle.click());
      expect(list.hidden).toBe(false);
      await act(async () => entry.click());
      expect(list.hidden).toBe(true);
      const back = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === `${source}/sample`,
      )!;
      await act(async () => back.click());
      expect(list.hidden).toBe(false);
    },
  );

  it("两组共用条目，内置把手禁用，同名用户技能正常操作，旧读取不能覆盖保存结果", async () => {
    let skills = [skill("custom", "builtin"), skill("custom", "user"), skill("another", "user")];
    let finish!: () => void;
    let finish_read!: () => void;
    let hold_read = false;
    mocks.api.mockImplementation(
      async (path: string, body: { source: string; name: string; enabled: boolean }) => {
        if (path === "/api/skills/snapshot" && hold_read) {
          const previous = skills;
          await new Promise<void>((resolve) => {
            finish_read = resolve;
          });
          return { skills: previous };
        }
        if (path === "/api/skills/enabled") {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          skills = skills.map((item) =>
            item.source === body.source && item.name === body.name
              ? { ...item, enabled: body.enabled }
              : item,
          );
        }
        return { skills };
      },
    );
    await render();
    const rows = [...container.querySelectorAll<HTMLElement>(".document-list__row")].filter((row) =>
      row.querySelector(
        '.document-list__open[aria-label="custom"], .document-list__open[aria-label="another"]',
      ),
    );
    expect(rows[0]?.querySelector<HTMLButtonElement>(".document-list__handle")?.disabled).toBe(
      true,
    );
    expect(rows[1]?.querySelector<HTMLButtonElement>(".document-list__handle")?.disabled).toBe(
      false,
    );
    expect(rows[2]?.querySelector<HTMLButtonElement>(".document-list__handle")?.disabled).toBe(
      false,
    );
    const builtin_toggle = rows[0]?.querySelector(
      '.document-list__actions button[aria-pressed="false"]',
    );
    const toggle = rows[1]?.querySelector<HTMLButtonElement>(
      '.document-list__actions button[aria-pressed="false"]',
    );
    hold_read = true;
    mocks.settings = {};
    await render();
    await act(async () => toggle?.click());
    expect(container.querySelector<HTMLElement>(".knowledge-page__list")?.hidden).toBe(false);
    expect(mocks.api).toHaveBeenCalledWith("/api/skills/enabled", {
      source: "user",
      name: "custom",
      enabled: false,
    });
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => finish());
    await act(async () => finish_read());
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(builtin_toggle?.getAttribute("aria-pressed")).toBe("false");
  });

  it("保存失败保留原状态并显示错误", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/skills/enabled") throw new Error("disk full");
      return { skills: [skill("custom", "user")] };
    });
    await render();
    const toggle = container.querySelector<HTMLButtonElement>(
      '.document-list__actions button[aria-pressed="false"]',
    );
    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.any(Error));
  });
});
