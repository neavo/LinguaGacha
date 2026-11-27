import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import type { AgentSkillEntry, AgentSkillIdentity } from "@shared/agent-skills";
import { SkillsPage } from "./page";
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
  useRuntimeSnapshot: () => ({
    projects: { project: { agent: mocks.owner === "agent" } },
  }),
  useDesktopState: () => ({ settings_snapshot: mocks.settings }),
}));
vi.mock("./skill-editor", () => ({
  SkillEditor: ({ skill, on_back }: { skill: AgentSkillIdentity; on_back: () => void }) => (
    <button onClick={on_back}>
      {skill.source}/{skill.name}
    </button>
  ),
}));
vi.mock("./personality-editor", () => ({
  PersonalityEditor: ({ on_back }: { on_back: () => void }) => (
    <button onClick={on_back}>返回角色设定列表</button>
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
      "pt-BR": "Descrição",
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
            <SkillsPage />
          </TooltipProvider>
        </LocaleProvider>,
      ),
    );
  }

  it("用户组始终保留角色设定入口，技能列表加载中也能打开独立编辑器", async () => {
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
    await act(async () => personality.click());
    const back = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "返回角色设定列表",
    )!;
    await act(async () => back.click());
    await act(async () => resolve({ skills: [] }));
    expect(personality.closest("ul")?.children).toHaveLength(1);
  });

  it("安装指南可取消，前往 Agent 时携带请求和占位选区", async () => {
    mocks.api.mockResolvedValue({ skills: [] });
    await render();
    const guide = zh_cn_knowledge_page.install;
    const help = container.querySelector<HTMLButtonElement>(`button[aria-label="${guide.title}"]`)!;
    /** 查找弹窗显示的操作按钮。 */
    const action = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
        (button) => button.textContent?.startsWith(text),
      )!;
    await act(async () => help.click());
    await act(async () => action("取消").click());
    expect(mocks.navigate_to_agent).not.toHaveBeenCalled();
    await act(async () => help.click());
    await act(async () => action("由 AGENT 处理").click());
    const request = mocks.navigate_to_agent.mock.calls[0]![0];
    expect(request.text).toBe(guide.request.replace("{PLACEHOLDER}", guide.placeholder));
    expect(request.text.slice(request.selection.from, request.selection.to)).toBe(
      guide.placeholder,
    );
  });

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
    "%s 技能有开关并可打开详情，只有用户包可拖拽",
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
      expect(handle.disabled).toBe(source === "builtin");
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
    const [user, builtin] = container.querySelectorAll<HTMLElement>("section.document-list");
    expect(user?.getAttribute("aria-label")).toBe(zh_cn_knowledge_page.user);
    expect(builtin?.getAttribute("aria-label")).toBe(zh_cn_knowledge_page.builtin);
    const names = (group: HTMLElement) =>
      [...group.querySelectorAll("h3")].map((heading) => heading.textContent);
    expect(names(user!)).toEqual(["personality", "custom", "another"]);
    expect(names(builtin!)).toEqual(["custom"]);
    expect(user?.querySelector<HTMLButtonElement>(".document-list__handle")?.disabled).toBe(true);
    const badges = container.querySelectorAll('[data-slot="badge"]');
    expect(badges).toHaveLength(1);
    expect(builtin?.querySelector('.document-list__header [data-slot="badge"]')).toBe(badges[0]);
    expect(badges[0]?.textContent).toBe(zh_cn_knowledge_page.readonly);
    const builtin_toggle = builtin!.querySelector(
      '.document-list__actions button[aria-pressed="false"]',
    )!;
    const toggle = user!.querySelector<HTMLButtonElement>(
      '.document-list__actions button[aria-pressed="false"]',
    )!;
    hold_read = true;
    mocks.settings = {};
    await render();
    await act(async () => toggle.click());
    expect(container.querySelector<HTMLElement>(".knowledge-page__list")?.hidden).toBe(false);
    expect(mocks.api).toHaveBeenCalledWith("/api/skills/enabled", {
      source: "user",
      name: "custom",
      enabled: false,
    });
    await act(async () => finish());
    await act(async () => finish_read());
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(builtin_toggle.getAttribute("aria-pressed")).toBe("false");
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
